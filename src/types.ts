export interface SlackMessage {
  text: string;
  user: string;
  ts: string;
  bot_id?: string;
}

export interface TopicResult {
  term: string;
  count: number;
}

export interface PhraseResult {
  phrase: string;
  count: number;
}

export interface SummaryData {
  messageCount: number;
  uniqueUsers: number;
  topics: TopicResult[];
  phrases: PhraseResult[];
}