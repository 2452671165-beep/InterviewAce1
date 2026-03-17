/**
 * 定义应用中用到的数据类型
 */

export interface Question {
  id: string;
  text: string;
  description: string;
  tips: string[]; // 新增：回答思路与提示
}

export interface SentenceAnalysis {
  original: string;
  polished: string;
  explanation: string;
  // 新增：用于二次练习的状态
  rePracticeTranscript?: string;
  rePracticeFeedback?: string;
  userAudioUrl?: string;
  isRecording?: boolean;
}

export interface FollowUp {
  question: string;
  userAnswer?: string;
}

export interface Feedback {
  scores: {
    fluency: number;      // 流畅度
    naturalness: number;  // 表达自然度
    accuracy: number;     // 语言准确度
    completeness: number; // 回答完整度
  };
  totalScore: number;
  strengths: string[];    // 优点
  improvements: string[]; // 待提升点
  suggestions: string;    // 下次建议
}

export interface OverallAnalysis {
  evaluation: string;
  suggestions: string[];
  fullPolishedAnswer: string;
  // 用于全篇练习的状态
  rePracticeTranscript?: string;
  rePracticeFeedback?: string;
  userAudioUrl?: string;
  isRecording?: boolean;
}

export interface WordInfo {
  definition: string;
  phonetic: string;
}

export type AppStep = 'HOME' | 'SELECT' | 'PRACTICE' | 'ANALYSIS' | 'FOLLOWUP' | 'REPORT' | 'CUSTOMIZE';
