import express from 'express';
import dotenv from 'dotenv';
import serverless from 'serverless-http';
import { PersonalSlackSummarizer } from './slackSummarizer.js';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint
router.get('/', (req, res) => {
  res.json({ message: 'Personal Slack Summarizer is running!' });
});

// Manual summary trigger - wait for completion
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

    // Wait for the summary to be sent before responding
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

// Slack slash command - wait for completion
router.post('/slack/my-summary', async (req, res) => {
  try {
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;

    const summarizer = new PersonalSlackSummarizer(userId);
    
    // Do all the work first
    const summary = await summarizer.summarizeAllMyDMs(days);
    await summarizer.sendSummaryToMyself(summary);

    // Then respond to Slack
    res.status(200).send('✅ Personal chat summary generated and sent to your DMs!');

  } catch (error) {
    console.error('Error handling personal summary command:', error);
    res.status(500).send('❌ Error generating summary. Please try again.');
  }
});

// Channel summarization - wait for completion
router.post('/slack/summarize', async (req, res) => {
  try {
    const channelId = req.body.channel_id;
    const userId = req.body.user_id;
    const text = req.body.text || '';
    const days = parseInt(text.split(' ')[0]) || 1;
    const responseUrl = req.body.response_url;

    // 1. Immediately respond to Slack
    res.status(200).json({
      response_type: 'ephemeral',
      text: '⏳ Generating channel summary... You will see it here soon!'
    });

    // 2. Do the work asynchronously (no await here)
    (async () => {
      const summarizer = new PersonalSlackSummarizer(userId);
      const summary = await summarizer.summarizeChannel(channelId, days);

      // 3. Post the summary to the response_url
      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response_type: 'in_channel',
            text: `<@${userId}> requested a summary:\n\n${summary}`,
          }),
        });
      } else {
        // Fallback: post to channel if response_url is missing
        await summarizer.postSummary(channelId, `<@${userId}> requested a summary:\n\n${summary}`);
      }
    })();

  } catch (error) {
    console.error('Error handling channel summary command:', error);
    // You can't send another response here, but you can log the error
  }
});

app.use('/.netlify/functions/api', router);

// Local development server
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Personal Slack Summarizer running on port ${port}`);
  });
}

export default app;
export const handler = serverless(app);