import express from 'express';
import dotenv from 'dotenv';
import { PersonalSlackSummarizer } from './slackSummarizer.js';
// Re-enable cron for Railway's persistent server
import * as cron from 'node-cron';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse form data and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Personal Slack Summarizer is running!' });
});

// Manual summary trigger (HTTP POST)
app.post('/summarize-my-chats', async (req, res) => {
  try {
    const days = parseInt(req.body.days) || 1;
    const type = req.body.type || 'all';

    const tempSummarizer = new PersonalSlackSummarizer(process.env.MY_USER_ID || '');
    const myUserId = process.env.MY_USER_ID || await tempSummarizer.getMyUserId();

    const summarizer = new PersonalSlackSummarizer(myUserId);

    let summary: string;

    if (type === 'all') {
      summary = await summarizer.summarizeAllMyDMs(days);
    } else {
      summary = await summarizer.summarizeSpecificDM(type, days);
    }

    await summarizer.sendSummaryToMyself(summary);

    res.json({
      message: 'Summary generated and sent to your DMs!',
      summary: summary
    });

  } catch (error) {
    console.error('Error generating personal summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Slack slash command endpoint - async processing with immediate response
app.post('/slack/my-summary', async (req, res) => {
  try {
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    // Acknowledge immediately to Slack
    res.status(200).send('⏳ Generating your personal chat summary...');

    // Process asynchronously in the background
    setImmediate(async () => {
      try {
        const summarizer = new PersonalSlackSummarizer(userId);
        const summary = await summarizer.summarizeAllMyDMs(days);
        await summarizer.sendSummaryToMyself(summary);
        console.log(`✅ Personal summary completed for user ${userId}`);
      } catch (error) {
        console.error('❌ Error in background personal summary processing:', error);
      }
    });

  } catch (error) {
    console.error('Error handling personal summary command:', error);
    res.status(500).send('❌ Error processing request');
  }
});

// Channel summarization endpoint - async processing with immediate response
app.post('/slack/summarize', async (req, res) => {
  try {
    const channelId = req.body.channel_id;
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    // Acknowledge immediately to Slack
    res.status(200).send('⏳ Generating channel summary...');

    // Process asynchronously in the background
    setImmediate(async () => {
      try {
        const summarizer = new PersonalSlackSummarizer(userId);
        const summary = await summarizer.summarizeChannel(channelId, days);
        await summarizer.postSummary(channelId, `<@${userId}> requested a summary:\n\n${summary}`);
        console.log(`✅ Channel summary completed for channel ${channelId}`);
      } catch (error) {
        console.error('❌ Error in background channel summary processing:', error);
        // Try to post error message to channel
        try {
          const errorSummarizer = new PersonalSlackSummarizer(userId);
          await errorSummarizer.postSummary(channelId, `❌ <@${userId}> Sorry, there was an error generating the summary. Please try again.`);
        } catch (postError) {
          console.error('❌ Failed to post error message:', postError);
        }
      }
    });

  } catch (error) {
    console.error('Error handling channel summary command:', error);
    res.status(500).send('❌ Error processing request');
  }
});

// Re-enable scheduled daily summary for Railway's persistent server
if (process.env.ENABLE_DAILY_SUMMARY === 'true') {
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('🕘 Running scheduled daily summary...');
      const myUserId = process.env.MY_USER_ID;
      if (!myUserId) {
        console.error('MY_USER_ID not set in environment variables');
        return;
      }
      const summarizer = new PersonalSlackSummarizer(myUserId);
      const summary = await summarizer.summarizeAllMyDMs(1);
      await summarizer.sendSummaryToMyself(`🌅 *Daily Chat Summary*\n\n${summary}`);
      console.log('✅ Daily summary completed');
    } catch (error) {
      console.error('❌ Error in scheduled summary:', error);
    }
  });
  console.log('📅 Daily summary cron job enabled (9 AM daily)');
}

// Start the server
app.listen(port, () => {
  console.log(`🚀 Personal Slack Summarizer running on port ${port}`);
  console.log(`📱 Manual summary: POST to /summarize-my-chats`);
  console.log(`💬 Slack slash command: /my-summary [days]`);
  console.log(`📢 Channel summary slash command: /summarize [days]`);
  console.log(`🌐 Health check: GET /`);
});

export default app;