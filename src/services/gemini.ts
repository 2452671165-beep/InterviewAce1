import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { SentenceAnalysis, Feedback, OverallAnalysis } from "../types";

// 获取 AI 实例的辅助函数
const getAI = () => {
  // 优先从 process.env 获取（由 Vite define 注入），其次从 import.meta.env 获取
  const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
  
  if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey === "") {
    console.error('API Key is missing or invalid:', apiKey);
    throw new Error("MISSING_API_KEY");
  }
  
  return new GoogleGenAI({ apiKey });
};

/**
 * 通用的 Gemini 请求包装器，包含重试逻辑
 */
async function callGeminiWithRetry(fn: () => Promise<any>, retries = 3, delay = 2000): Promise<any> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const isRetryable = 
      error?.status === 429 || 
      errorMessage.includes('429') ||
      errorMessage.includes('Rpc failed') ||
      errorMessage.includes('xhr error') ||
      errorMessage.includes('fetch') ||
      errorMessage.includes('NetworkError');

    if (isRetryable && retries > 0) {
      console.log(`Gemini API 请求失败 (${errorMessage})，${delay}ms 后重试... (剩余重试次数: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiWithRetry(fn, retries - 1, delay * 2);
    }

    if (errorMessage.includes('429')) {
      throw new Error("API_QUOTA_EXCEEDED");
    }
    
    throw error;
  }
}

/**
 * 1. 将用户的回答拆分成句子并进行地道改写
 */
export async function analyzeAnswer(question: string, answer: string): Promise<SentenceAnalysis[]> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
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
      contents: prompt,
      config: {
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
  });
}

/**
 * 2. 语音合成 (TTS) - 将地道改写转为语音
 */
export async function textToSpeech(text: string): Promise<string> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: `Read this naturally for an interview: ${text}`,
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
  }, 2, 1000); // 语音合成重试次数少一点，延迟短一点
}

/**
 * 3. 对比用户模仿的回答并给出新一轮建议
 */
export async function compareAndFeedback(polished: string, userAttempt: string): Promise<string> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
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
      contents: prompt,
    });
    
    // 确保输出不带 * 号
    return (response.text || "太棒了！继续加油。").replace(/\*/g, '');
  });
}

/**
 * 4. 根据回答生成追问
 */
export async function generateFollowUp(question: string, answer: string): Promise<string> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
    const prompt = `
      You are an interviewer. The candidate just answered "${question}" with "${answer}".
      Based on their answer, ask ONE professional follow-up question in English to dig deeper into their experience or skills.
      Keep it concise and challenging.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "Could you tell me more about that?";
  });
}

/**
 * 5. 生成最终评分反馈
 */
export async function generateFeedback(question: string, fullConversation: string): Promise<Feedback> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
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
      contents: prompt,
      config: {
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
  });
}

/**
 * 6. 生成全篇回答的评价和建议
 */
export async function analyzeOverallAnswer(question: string, originalAnswer: string): Promise<OverallAnalysis> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
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
      contents: prompt,
      config: {
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
  });
}

/**
 * 7. 获取个性化定制的问题列表
 */
export async function getCustomizationQuestions(question: string): Promise<string[]> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
    const prompt = `
      The user wants to prepare a personalized answer for the interview question: "${question}".
      Please list 4-5 specific questions in English that I should ask the user to gather enough personal information (like school, personality, internship experience, specific achievements, etc.) to draft a perfect answer.
      Return the questions as a simple JSON array of strings.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    });

    return JSON.parse(response.text || "[]");
  });
}

/**
 * 8. 根据收集到的信息生成个性化完整答案
 */
export async function generatePersonalizedAnswer(question: string, info: Record<string, string>): Promise<string> {
  return callGeminiWithRetry(async () => {
    const ai = getAI();
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
      contents: prompt,
    });

    return response.text || "";
  });
}

/**
 * 9. 获取单词释义与发音
 */
// 单词释义缓存，避免重复请求
const wordCache = new Map<string, { definition: string; phonetic: string }>();

/**
 * 9. 获取单词释义与发音
 */
export async function getWordDefinition(word: string, context: string): Promise<{ definition: string; phonetic: string }> {
  const cleanWord = word.toLowerCase().trim();
  
  // 1. 检查缓存
  if (wordCache.has(cleanWord)) {
    return wordCache.get(cleanWord)!;
  }

  // 2. 简单常用词快速处理（减少 AI 请求）
  const commonWords: Record<string, { d: string; p: string }> = {
    'bring': { d: '带来；引起', p: '/brɪŋ/' },
    'think': { d: '认为；思考', p: '/θɪŋk/' },
    'work': { d: '工作；起作用', p: '/wɜːrk/' },
    'good': { d: '好的；优秀的', p: '/ɡʊd/' },
    'interview': { d: '面试；采访', p: '/ˈɪntərvjuː/' },
    'experience': { d: '经验；经历', p: '/ɪkˈspɪriəns/' },
    'skills': { d: '技能；技巧', p: '/skɪlz/' },
    'company': { d: '公司；陪伴', p: '/ˈkʌmpəni/' },
  };

  if (commonWords[cleanWord]) {
    const res = { definition: commonWords[cleanWord].d, phonetic: commonWords[cleanWord].p };
    wordCache.set(cleanWord, res);
    return res;
  }

  try {
    const ai = getAI();
    // 优化 Prompt，要求更简洁，减少 Token 生成时间
    const prompt = `Define "${cleanWord}" in Chinese (max 10 chars) and provide IPA. Context: "${context.substring(0, 100)}". Return JSON: {"d": "...", "p": "..."}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            d: { type: Type.STRING, description: "Chinese definition" },
            p: { type: Type.STRING, description: "IPA phonetic" },
          },
          required: ["d", "p"],
        },
      },
    });

    const data = JSON.parse(response.text || '{"d": "未找到", "p": ""}');
    const result = { definition: data.d, phonetic: data.p };
    
    // 存入缓存
    wordCache.set(cleanWord, result);
    return result;
  } catch (error) {
    console.error("Error in getWordDefinition:", error);
    return { definition: "查询失败", phonetic: "" };
  }
}
