import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { SentenceAnalysis, Feedback, OverallAnalysis } from "../types";

// 初始化 AI (API Key 会由平台自动注入)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * 1. 将用户的回答拆分成句子并进行地道改写
 */
export async function analyzeAnswer(question: string, answer: string): Promise<SentenceAnalysis[]> {
  const prompt = `
    You are an expert English interview coach. 
    The user is answering the interview question: "${question}".
    The user's answer is: "${answer}".
    
    Please:
    1. Split the answer into individual sentences.
    2. For each sentence, provide a more natural and professional version suitable for a job interview.
    3. Provide a brief explanation in Chinese for why the polished version is better.
    
    Return the result in JSON format as an array of objects with keys: "original", "polished", "explanation".
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original: { type: Type.STRING },
            polished: { type: Type.STRING },
            explanation: { type: Type.STRING },
          },
          required: ["original", "polished", "explanation"],
        },
      },
    },
  });

  return JSON.parse(response.text || "[]");
}

/**
 * 2. 语音合成 (TTS) - 将地道改写转为语音
 */
export async function textToSpeech(text: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this naturally for an interview: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, // 优雅的女性声音
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio || "";
}

/**
 * 3. 对比用户模仿的回答并给出新一轮建议
 */
export async function compareAndFeedback(polished: string, userAttempt: string): Promise<string> {
  const prompt = `
    The user is trying to mimic this polished interview sentence: "${polished}".
    The user's new attempt is: "${userAttempt}".
    
    Please compare the two and provide a short, encouraging feedback in Chinese.
    Focus on:
    1. Pronunciation, intonation (语音语调), and rhythm.
    2. Use of more local/idiomatic vocabulary and phrases (地道词汇词组).
    3. How close they are to the polished version.
    4. One specific tip to make it sound even more like a native speaker.
    
    CRITICAL: 
    - Do NOT use any asterisks (*) or markdown bolding in your response.
    - Keep the response under 100 words.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  
  // 确保输出不带 * 号
  return (response.text || "").replace(/\*/g, '');
}

/**
 * 4. 根据回答生成追问
 */
export async function generateFollowUp(question: string, answer: string): Promise<string> {
  const prompt = `
    You are an interviewer. The candidate just answered "${question}" with "${answer}".
    Based on their answer, ask ONE professional follow-up question in English to dig deeper into their experience or skills.
    Keep it concise and challenging.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  return response.text || "";
}

/**
 * 5. 生成最终评分反馈
 */
export async function generateFeedback(question: string, fullConversation: string): Promise<Feedback> {
  const prompt = `
    Analyze the following English interview practice session.
    Original Question: ${question}
    Conversation History: ${fullConversation}
    
    Provide a detailed feedback in JSON format with the following structure:
    {
      "scores": {
        "fluency": number (1-100),
        "naturalness": number (1-100),
        "accuracy": number (1-100),
        "completeness": number (1-100)
      },
      "totalScore": number (1-100),
      "strengths": ["string", "string"],
      "improvements": ["string", "string"],
      "suggestions": "string (in Chinese)"
    }
    All text feedback and suggestions should be in Chinese.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scores: {
            type: Type.OBJECT,
            properties: {
              fluency: { type: Type.NUMBER },
              naturalness: { type: Type.NUMBER },
              accuracy: { type: Type.NUMBER },
              completeness: { type: Type.NUMBER },
            },
            required: ["fluency", "naturalness", "accuracy", "completeness"],
          },
          totalScore: { type: Type.NUMBER },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { type: Type.STRING },
        },
        required: ["scores", "totalScore", "strengths", "improvements", "suggestions"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

/**
 * 6. 生成全篇回答的评价和建议
 */
export async function analyzeOverallAnswer(question: string, originalAnswer: string): Promise<OverallAnalysis> {
  const prompt = `
    The user is answering the interview question: "${question}".
    The full original answer is: "${originalAnswer}".
    
    Please provide:
    1. A brief overall evaluation of the answer in Chinese.
    2. 3-4 specific suggestions for improvement in Chinese (focus on logic, structure, and impact).
    3. A complete, cohesive, and polished version of the entire answer in English.
    
    Return the result in JSON format with keys: "evaluation", "suggestions" (array), "fullPolishedAnswer".
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          evaluation: { type: Type.STRING },
          suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          fullPolishedAnswer: { type: Type.STRING },
        },
        required: ["evaluation", "suggestions", "fullPolishedAnswer"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

/**
 * 7. 获取个性化定制的问题列表
 */
export async function getCustomizationQuestions(question: string): Promise<string[]> {
  const prompt = `
    The user wants to prepare a personalized answer for the interview question: "${question}".
    Please list 4-5 specific questions in English that I should ask the user to gather enough personal information (like school, personality, internship experience, specific achievements, etc.) to draft a perfect answer.
    Return the questions as a simple JSON array of strings.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
  });

  return JSON.parse(response.text || "[]");
}

/**
 * 8. 根据收集到的信息生成个性化完整答案
 */
export async function generatePersonalizedAnswer(question: string, info: Record<string, string>): Promise<string> {
  const infoStr = Object.entries(info).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n');
  const prompt = `
    The interview question is: "${question}".
    I have collected the following personal information from the candidate:
    ${infoStr}
    
    Based on this information, please write a professional, natural, and high-impact full answer in English for the candidate to use in an interview.
    The answer should be cohesive and sound like a real person speaking.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return response.text || "";
}

/**
 * 9. 获取单词释义与发音
 */
export async function getWordDefinition(word: string, context: string): Promise<{ definition: string; phonetic: string }> {
  const prompt = `
    Provide a brief Chinese definition and the IPA phonetic symbols for the English word "${word}" as used in this context: "${context}".
    
    Return the result in JSON format with keys: "definition", "phonetic".
    Keep the definition very concise (under 15 words).
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          definition: { type: Type.STRING },
          phonetic: { type: Type.STRING },
        },
        required: ["definition", "phonetic"],
      },
    },
  });

  try {
    return JSON.parse(response.text || '{"definition": "未找到释义", "phonetic": ""}');
  } catch (e) {
    return { definition: "未找到释义", phonetic: "" };
  }
}
