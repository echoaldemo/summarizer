import express from 'express';
import dotenv from 'dotenv';
import serverless from 'serverless-http';
import { PersonalSlackSummarizer } from './slackSummarizer.js'; // .js extension needed
// Remove cron import for serverless

dotenv.config();

const app = express();
const router = express.Router();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint
router.get('/', (req, res) => {
  res.json({ message: 'Personal Slack Summarizer is running!' });
});

// Manual summary trigger
router.post('/summarize-my-chats', async (req, res) => {
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

// Slack slash command endpoint
router.post('/slack/my-summary', async (req, res) => {
  try {
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    res.status(200).send('Generating your personal chat summary...');

    const summarizer = new PersonalSlackSummarizer(userId);
    const summary = await summarizer.summarizeAllMyDMs(days);
    await summarizer.sendSummaryToMyself(summary);

  } catch (error) {
    console.error('Error handling personal summary command:', error);
  }
});

// Channel summarization endpoint
router.post('/slack/summarize', async (req, res) => {
  try {
    const channelId = req.body.channel_id;
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    res.status(200).send('Generating channel summary...');

    const summarizer = new PersonalSlackSummarizer(userId);
    const summary = await summarizer.summarizeChannel(channelId, days);
    await summarizer.postSummary(channelId, `<@${userId}> requested a summary:\n${summary}`);

  } catch (error) {
    console.error('Error handling channel summary command:', error);
    res.status(500).send('Internal server error');
  }
});

// Mount router
app.use('/.netlify/functions/api', router);

// Local development server
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Personal Slack Summarizer running on port ${port}`);
    console.log(`📱 Manual summary: POST to /summarize-my-chats`);
    console.log(`💬 Slack slash command: /my-summary [days]`);
    console.log(`📢 Channel summary slash command: /summarize [days]`);
  });
}

export default app;
export const handler = serverless(app);