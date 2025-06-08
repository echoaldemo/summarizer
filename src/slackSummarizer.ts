import { WebClient } from '@slack/web-api';
import { SlackMessage } from './types';
import OpenAI from 'openai';

export class PersonalSlackSummarizer {
  private slack: WebClient;
  private myUserId: string;
  private openai: OpenAI;

  constructor(myUserId: string) {
    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.myUserId = myUserId;
    
    // Initialize OpenAI
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Get DM conversation with a specific user
  async getDMMessages(otherUserId: string, days: number = 1): Promise<SlackMessage[]> {
    try {
      const oldest = Math.floor((Date.now() - (days * 24 * 60 * 60 * 1000)) / 1000);
      
      // Open DM conversation
      const dmResult = await this.slack.conversations.open({
        users: otherUserId
      });
      
      const channelId = dmResult.channel?.id;
      if (!channelId) {
        throw new Error('Could not open DM conversation');
      }

      // Get message history
      const result = await this.slack.conversations.history({
        channel: channelId,
        oldest: oldest.toString(),
        limit: 1000
      });

      const messages = result.messages as SlackMessage[];
      
      return messages.filter(msg => 
        msg.text && 
        !msg.bot_id
      );
    } catch (error) {
      console.error('Error fetching DM messages:', error);
      return [];
    }
  }

  // Get all your DM conversations
  async getAllMyDMs(days: number = 1): Promise<{ [userId: string]: SlackMessage[] }> {
    try {
      // Get list of DM conversations
      const conversationsResult = await this.slack.conversations.list({
        types: 'im',
        limit: 1000
      });

      const dmConversations = conversationsResult.channels || [];
      const allDMs: { [userId: string]: SlackMessage[] } = {};

      for (const conversation of dmConversations) {
        if (conversation.id && conversation.user) {
          const messages = await this.getChannelMessages(conversation.id, days);
          if (messages.length > 0) {
            allDMs[conversation.user] = messages;
          }
        }
      }

      return allDMs;
    } catch (error) {
      console.error('Error fetching all DMs:', error);
      return {};
    }
  }

  // Get messages from any channel/DM by ID
  async getChannelMessages(channelId: string, days: number = 1): Promise<SlackMessage[]> {
    try {
      const oldest = Math.floor((Date.now() - (days * 24 * 60 * 60 * 1000)) / 1000);
      
      const result = await this.slack.conversations.history({
        channel: channelId,
        oldest: oldest.toString(),
        limit: 1000
      });

      const messages = result.messages as SlackMessage[];
      
      return messages.filter(msg => 
        msg.text && 
        !msg.bot_id
      );
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
  }

  // Clean and prepare text for AI processing
  preprocessText(messages: SlackMessage[]): string[] {
    return messages.map(msg => {
      let text = msg.text;
      
      // Remove URLs
      text = text.replace(/https?:\/\/[^\s]+/g, '[URL]');
      
      // Remove user mentions but keep the context
      text = text.replace(/<@([A-Z0-9]+)>/g, '@user');
      
      // Remove channel mentions
      text = text.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');
      
      // Remove emojis but keep text emojis
      text = text.replace(/:[a-z_]+:/g, '');
      
      // Clean up extra spaces
      text = text.replace(/\s+/g, ' ').trim();
      
      return text;
    }).filter(text => text.length > 5); // Filter out very short messages
  }

  // Get user info for better context
  async getUserInfo(userId: string): Promise<string> {
    try {
      const result = await this.slack.users.info({ user: userId });
      return result.user?.real_name || result.user?.name || 'Unknown User';
    } catch (error) {
      return 'Unknown User';
    }
  }

  // Format messages with user context for AI
  async formatMessagesForAI(messages: SlackMessage[]): Promise<string> {
    const formattedMessages: string[] = [];
    
    for (const msg of messages.slice(-50)) { // Limit to last 50 messages to avoid token limits
      const userName = await this.getUserInfo(msg.user);
      const cleanText = this.preprocessText([msg])[0];
      if (cleanText) {
        formattedMessages.push(`${userName}: ${cleanText}`);
      }
    }
    
    return formattedMessages.join('\n');
  }

  // Generate summary using OpenAI
  async generateOpenAISummary(messages: SlackMessage[], conversationType: string = "conversation"): Promise<string> {
    try {
      if (messages.length === 0) {
        return "No messages to summarize.";
      }

      const formattedMessages = await this.formatMessagesForAI(messages);
      
      if (formattedMessages.length === 0) {
        return "No meaningful messages found to summarize.";
      }

      const prompt = `Please provide a concise and helpful summary of this Slack ${conversationType}. Focus on:
1. Main topics discussed
2. Key decisions made
3. Action items or next steps
4. Important information shared

Here are the messages:

${formattedMessages}

Summary:`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that summarizes Slack conversations. Provide clear, concise summaries that highlight the most important information."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      const summary = response.choices[0].message?.content?.trim() || "Unable to generate summary.";
      
      return summary;
    } catch (error: any) {
      console.error('Error generating OpenAI summary:', error.message);
      
      if (error.code === 'insufficient_quota') {
        return "❌ OpenAI API quota exceeded. Please check your billing settings.";
      } else if (error.code === 'invalid_api_key') {
        return "❌ Invalid OpenAI API key. Please check your configuration.";
      } else {
        return `❌ Error generating AI summary: ${error.message}`;
      }
    }
  }

  // Generate the final formatted summary
  async generatePersonalSummary(messages: SlackMessage[], conversationType: string = "conversations"): Promise<string> {
    try {
      const aiSummary = await this.generateOpenAISummary(messages, conversationType);
      
      const messageCount = messages.length;
      const uniqueUsers = new Set(messages.map(msg => msg.user)).size;
      const timeRange = this.getTimeRange(messages);
      
      let summary = `📱 *Your Personal Chat Summary*\n\n`;
      summary += `📊 *Activity:* ${messageCount} messages from ${uniqueUsers} user(s)\n`;
      summary += `⏰ *Time Range:* ${timeRange}\n\n`;
      summary += `🤖 *AI Summary:*\n${aiSummary}\n\n`;
      summary += `📅 *Generated:* ${new Date().toLocaleString()}`;

      return summary;
    } catch (error) {
      console.error('Error generating personal summary:', error);
      return "❌ Error generating summary.";
    }
  }

  // Helper method to get time range of messages
  private getTimeRange(messages: SlackMessage[]): string {
    if (messages.length === 0) return "No messages";
    
    const timestamps = messages.map(msg => parseFloat(msg.ts) * 1000);
    const earliest = new Date(Math.min(...timestamps));
    const latest = new Date(Math.max(...timestamps));
    
    if (earliest.toDateString() === latest.toDateString()) {
      return earliest.toDateString();
    } else {
      return `${earliest.toDateString()} - ${latest.toDateString()}`;
    }
  }

  // Summarize a specific DM conversation
  async summarizeSpecificDM(otherUserId: string, days: number = 1): Promise<string> {
    try {
      console.log(`Summarizing DM with user ${otherUserId} for the last ${days} day(s)...`);
      
      const messages = await this.getDMMessages(otherUserId, days);
      
      if (messages.length === 0) {
        return "No messages found in the specified time period.";
      }

      const otherUserName = await this.getUserInfo(otherUserId);
      return await this.generatePersonalSummary(messages, `DM conversation with ${otherUserName}`);
    } catch (error) {
      console.error('Error summarizing DM:', error);
      return "❌ Error generating DM summary.";
    }
  }

  // Summarize all your DMs
  async summarizeAllMyDMs(days: number = 1): Promise<string> {
    try {
      console.log(`Summarizing all your DMs for the last ${days} day(s)...`);
      
      const allDMs = await this.getAllMyDMs(days);
      const allMessages: SlackMessage[] = [];
      
      // Combine all DM messages
      Object.values(allDMs).forEach(messages => {
        allMessages.push(...messages);
      });
      
      if (allMessages.length === 0) {
        return "No DM messages found in the specified time period.";
      }

      // Sort messages by timestamp
      allMessages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

      return await this.generatePersonalSummary(allMessages, `${Object.keys(allDMs).length} DM conversations`);
    } catch (error) {
      console.error('Error summarizing all DMs:', error);
      return "❌ Error generating summary of all DMs.";
    }
  }

  // Summarize a specific channel
  async summarizeChannel(channelId: string, days: number = 1): Promise<string> {
    try {
      console.log(`Summarizing channel ${channelId} for the last ${days} day(s)...`);
      
      const messages = await this.getChannelMessages(channelId, days);
      
      if (messages.length === 0) {
        return "No messages found in the specified time period.";
      }

      return await this.generatePersonalSummary(messages, "channel discussion");
    } catch (error) {
      console.error('Error summarizing channel:', error);
      return "❌ Error generating channel summary.";
    }
  }

 async postSummary(channelId: string, summary: string): Promise<void> {
    try {
      console.log(`Posting summary to channel ${channelId}...`);
      
      const result = await this.slack.chat.postMessage({
        channel: channelId,
        text: summary,
        mrkdwn: true
      });
      
      if (result.ok) {
        console.log('✅ Summary posted successfully!');
      } else {
        console.error('❌ Failed to post summary:', result.error);
        throw new Error(`Failed to post summary: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Error posting summary:', error);
      throw error; // Re-throw so the calling function knows it failed
    }
  }

  // Updated sendSummaryToMyself with better error handling
  async sendSummaryToMyself(summary: string): Promise<void> {
    try {
      console.log('Sending summary to yourself...');
      
      const dmResult = await this.slack.conversations.open({
        users: this.myUserId
      });
      
      const channelId = dmResult.channel?.id;
      if (!channelId) {
        throw new Error('Could not open DM with yourself');
      }

      const result = await this.slack.chat.postMessage({
        channel: channelId,
        text: summary,
        mrkdwn: true
      });
      
      if (result.ok) {
        console.log('✅ Summary sent to yourself successfully!');
      } else {
        console.error('❌ Failed to send summary:', result.error);
        throw new Error(`Failed to send summary: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Error sending summary to yourself:', error);
      throw error; // Re-throw so the calling function knows it failed
    }
  }

  // Get your user ID
  async getMyUserId(): Promise<string> {
    try {
      const result = await this.slack.auth.test();
      return result.user_id as string;
    } catch (error) {
      console.error('Error getting user ID:', error);
      throw error;
    }
  }
}

export default PersonalSlackSummarizer;