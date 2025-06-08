import express from 'express';
import dotenv from 'dotenv';
import { PersonalSlackSummarizer } from './slackSummarizer';
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
// Example: POST /summarize-my-chats with body { days: 3, type: "all" }
app.post('/summarize-my-chats', async (req, res) => {
  try {
    const days = parseInt(req.body.days) || 1;
    const type = req.body.type || 'all'; // 'all' or specific user ID

    // Get your user ID (or use from env)
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

// Slack slash command endpoint (e.g., /my-summary 3)
app.post('/slack/my-summary', async (req, res) => {
  try {
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    // Acknowledge immediately
    res.status(200).send('Generating your personal chat summary...');

    const summarizer = new PersonalSlackSummarizer(userId);
    const summary = await summarizer.summarizeAllMyDMs(days);
    await summarizer.sendSummaryToMyself(summary);

  } catch (error) {
    console.error('Error handling personal summary command:', error);
    // Don't send another response, as we've already acknowledged
  }
});

// New endpoint for channel summarization
app.post('/slack/summarize', async (req, res) => {
  try {
    const channelId = req.body.channel_id;
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    // Acknowledge immediately
    res.status(200).send('Generating channel summary...');

    const summarizer = new PersonalSlackSummarizer(userId);
    const summary = await summarizer.summarizeChannel(channelId, days);
    await summarizer.postSummary(channelId, `<@${userId}> requested a summary:\n${summary}`);

  } catch (error) {
    console.error('Error handling channel summary command:', error);
    res.status(500).send('Internal server error');
  }
});

// (Optional) Scheduled daily summary to yourself
// Uncomment to enable
/*
cron.schedule('0 9 * * *', async () => {
  try {
    const myUserId = process.env.MY_USER_ID;
    if (!myUserId) {
      console.error('MY_USER_ID not set in environment variables');
      return;
    }
    const summarizer = new PersonalSlackSummarizer(myUserId);
    const summary = await summarizer.summarizeAllMyDMs(1);
    await summarizer.sendSummaryToMyself(`🌅 *Daily Chat Summary*\n\n${summary}`);
  } catch (error) {
    console.error('Error in scheduled summary:', error);
  }
});
*/

app.listen(port, () => {
  console.log(`🚀 Personal Slack Summarizer running on port ${port}`);
  console.log(`📱 Manual summary: POST to /summarize-my-chats`);
  console.log(`💬 Slack slash command: /my-summary [days]`);
  console.log(`📢 Channel summary slash command: /summarize [days]`);
});