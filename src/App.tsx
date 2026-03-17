import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  Square, 
  ChevronRight, 
  RotateCcw, 
  CheckCircle2, 
  MessageSquare, 
  BarChart3, 
  ArrowLeft,
  Loader2,
  Sparkles,
  Play,
  Volume2,
  RefreshCw,
  History,
  Lightbulb,
  Info,
  Pause
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Question, SentenceAnalysis, Feedback, AppStep, OverallAnalysis, WordInfo } from './types';
import { 
  analyzeAnswer, 
  generateFollowUp, 
  generateFeedback, 
  textToSpeech, 
  compareAndFeedback, 
  analyzeOverallAnswer, 
  getCustomizationQuestions, 
  generatePersonalizedAnswer,
  getWordDefinition
} from './services/gemini';

// 预设面试题
const QUESTIONS: Question[] = [
  { 
    id: '1', 
    text: 'Please introduce yourself.', 
    description: '最基础的开场白，展示你的背景 and 优势。',
    tips: [
      '使用 Present-Past-Future 结构：现在在做什么，过去有什么成就，未来为什么想来这里。',
      '重点突出与岗位相关的 2-3 个核心技能。',
      '控制在 1-2 分钟内。'
    ]
  },
  { 
    id: '2', 
    text: 'Why do you want this job?', 
    description: '考察你对公司的了解和你的职业动机。',
    tips: [
      '展示你对公司的研究（如：企业文化、近期项目）。',
      '将公司的需求与你的职业目标对齐。',
      '表达你对这个行业或岗位的热情。'
    ]
  },
  { 
    id: '3', 
    text: 'What are your strengths and weaknesses?', 
    description: '考察你的自我认知和诚实度。',
    tips: [
      '优点：给出具体的例子证明（STAR法则）。',
      '缺点：选择一个真实的、但可以通过努力改进的缺点，并说明你正在如何改进。',
      '避免说“我太追求完美”这种伪装成缺点的优点。'
    ]
  },
  { 
    id: '4', 
    text: 'Tell me about a challenge you faced.', 
    description: '考察你解决问题的能力和抗压能力。',
    tips: [
      '使用 STAR 法则：Situation (情境), Task (任务), Action (行动), Result (结果)。',
      '重点放在 Action 上，展示你的逻辑思维和执行力。',
      '结果最好是量化的或有积极反馈的。'
    ]
  },
  { 
    id: '5', 
    text: 'Why should we hire you?', 
    description: '最后的机会，总结你的核心竞争力。',
    tips: [
      '总结你最匹配岗位的 3 个理由。',
      '强调你能为公司解决什么问题。',
      '展示你的独特性（Unique Selling Point）。'
    ]
  },
];

export default function App() {
  // --- 状态管理 ---
  const [step, setStep] = useState<AppStep>('HOME');
  useEffect(() => {
    (window as any)._currentStep = step;
  }, [step]);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<SentenceAnalysis[]>([]);
  const [overallAnalysis, setOverallAnalysis] = useState<OverallAnalysis | null>(null);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [wordCache, setWordCache] = useState<Record<string, WordInfo>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [langMode, setLangMode] = useState<'en-US' | 'zh-CN'>('en-US');
  const [audioState, setAudioState] = useState<{
    isPlaying: boolean;
    currentText: string | null;
  }>({ isPlaying: false, currentText: null });
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // --- 定制化流程状态 ---
  const [customQuestions, setCustomQuestions] = useState<string[]>([]);
  const [currentCustomIndex, setCurrentCustomIndex] = useState(0);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [customInput, setCustomInput] = useState('');

  // 语音识别引用
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // --- 初始化语音识别 ---
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      // 如果已经存在，先停止
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }

      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = langMode;

      recognitionRef.current.onresult = (event: any) => {
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript + ' ';
          }
        }
        
        const currentStep = (window as any)._currentStep;
        if (currentStep === 'PRACTICE') setTranscript(prev => prev + final);
        else if (currentStep === 'CUSTOMIZE') setCustomInput(prev => prev + final);
        else if (currentStep === 'FOLLOWUP') setFollowUpAnswer(prev => prev + final);
      };

      recognitionRef.current.onend = () => {
        // 如果是在录音状态下意外停止，重新开启（处理某些浏览器的自动停止）
        if ((window as any)._isRecording) {
          try { recognitionRef.current.start(); } catch(e) {}
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error !== 'no-speech') {
          setIsRecording(false);
          (window as any)._isRecording = false;
        }
      };
    }
  }, [langMode]);

  useEffect(() => {
    (window as any)._isRecording = isRecording;
  }, [isRecording]);

  // --- 业务逻辑处理 ---

  // 开始录音 (通用)
  // --- 辅助函数 ---
  const handleAIError = (error: unknown, defaultMsg: string) => {
    console.error(error);
    if (error instanceof Error && error.message === 'MISSING_API_KEY') {
      alert('检测到未配置 Gemini API Key。如果你是在 Vercel 部署的，请在 Vercel 项目设置中添加 GEMINI_API_KEY 环境变量。');
    } else if (error instanceof Error && error.message === 'API_QUOTA_EXCEEDED') {
      alert('哎呀，当前请求太频繁啦！由于使用的是免费版 Gemini，请稍等 1 分钟再试，或者考虑在 AI Studio 中更换一个 API Key。');
    } else {
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert(`${defaultMsg}\n\n错误详情: ${errorMsg}\n\n请检查网络或 API Key 权限。`);
    }
  };

  const startVoiceInput = (type: 'PRACTICE' | 'CUSTOMIZE' | 'FOLLOWUP') => {
    if (type === 'PRACTICE') setTranscript('');
    else if (type === 'CUSTOMIZE') setCustomInput('');
    else if (type === 'FOLLOWUP') setFollowUpAnswer('');
    
    setIsRecording(true);
    recognitionRef.current?.start();
  };

  // 停止录音 (通用)
  const stopVoiceInput = () => {
    setIsRecording(false);
    recognitionRef.current?.stop();
  };

  // 开始分析 (用于 PRACTICE)
  const startAnalysis = async () => {
    if (transcript.trim().length < 5) {
      alert('回答太短了，请多说一点哦');
      return;
    }

    setIsLoading(true);
    try {
      const [sentenceResult, overallResult] = await Promise.all([
        analyzeAnswer(selectedQuestion!.text, transcript),
        analyzeOverallAnswer(selectedQuestion!.text, transcript)
      ]);
      setAnalysis(sentenceResult);
      setOverallAnalysis(overallResult);
      setStep('ANALYSIS');
    } catch (error) {
      handleAIError(error, '分析失败，请重试。如果多次失败，请检查网络连接或 API Key 是否有效。');
    } finally {
      setIsLoading(false);
    }
  };

  // --- 定制化逻辑 ---
  const startCustomization = async () => {
    setIsLoading(true);
    try {
      const questions = await getCustomizationQuestions(selectedQuestion!.text);
      setCustomQuestions(questions);
      setCurrentCustomIndex(0);
      setCustomAnswers({});
      setCustomInput('');
      setStep('CUSTOMIZE');
    } catch (error) {
      handleAIError(error, '获取定制问题失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomAnswerSubmit = async () => {
    if (!customInput.trim()) return;

    const currentQuestion = customQuestions[currentCustomIndex];
    const newAnswers = { ...customAnswers, [currentQuestion]: customInput };
    setCustomAnswers(newAnswers);
    setCustomInput('');

    if (currentCustomIndex < customQuestions.length - 1) {
      setCurrentCustomIndex(prev => prev + 1);
    } else {
      // 所有问题回答完毕，生成答案
      setIsLoading(true);
      try {
        const fullAnswer = await generatePersonalizedAnswer(selectedQuestion!.text, newAnswers);
        // 生成答案后，直接进入分析页（模拟用户已经录制了这个答案）
        const [sentenceResult, overallResult] = await Promise.all([
          analyzeAnswer(selectedQuestion!.text, fullAnswer),
          analyzeOverallAnswer(selectedQuestion!.text, fullAnswer)
        ]);
        setAnalysis(sentenceResult);
        setOverallAnalysis(overallResult);
        setStep('ANALYSIS');
      } catch (error) {
        handleAIError(error, '生成答案失败');
      } finally {
        setIsLoading(false);
      }
    }
  };

  // 播放 AI 合成的语音 (支持暂停/恢复)
  const playPolishedAudio = async (text: string) => {
    // 如果当前正在播放且点击的是同一个文本，则切换暂停/恢复
    if (audioState.isPlaying && audioState.currentText === text) {
      if (audioContextRef.current?.state === 'running') {
        await audioContextRef.current.suspend();
        setAudioState(prev => ({ ...prev, isPlaying: false }));
      } else if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
        setAudioState(prev => ({ ...prev, isPlaying: true }));
      }
      return;
    }

    // 如果当前是暂停状态且点击的是同一个文本，则恢复
    if (!audioState.isPlaying && audioState.currentText === text && audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
      setAudioState(prev => ({ ...prev, isPlaying: true }));
      return;
    }

    // 如果正在播放别的，先停止
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
      audioSourceRef.current = null;
    }

    setIsLoading(true);
    try {
      const base64Data = await textToSpeech(text);
      if (!base64Data) return;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.error('AudioContext not supported');
        return;
      }
      
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      }
      
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Int16Array(len / 2);
      for (let i = 0; i < len; i += 2) {
        bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
      }

      const float32Data = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        float32Data[i] = bytes[i] / 32768;
      }

      const buffer = audioContext.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);
      
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      
      source.onended = () => {
        setAudioState({ isPlaying: false, currentText: null });
        audioSourceRef.current = null;
      };

      audioSourceRef.current = source;
      source.start();
      setAudioState({ isPlaying: true, currentText: text });
    } catch (error) {
      console.error('TTS Playback Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 针对单句的重新录音逻辑
  const startRePracticeRecording = async (index: number) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    const recognition = new ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript;
      setAnalysis(prev => prev.map((item, i) => i === index ? { ...item, rePracticeTranscript: result } : item));
    };

    mediaRecorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      setAnalysis(prev => prev.map((item, i) => i === index ? { ...item, userAudioUrl: audioUrl, isRecording: false } : item));
    };

    setAnalysis(prev => prev.map((item, i) => i === index ? { ...item, isRecording: true, rePracticeTranscript: '' } : item));
    mediaRecorder.start();
    recognition.start();
  };

  const stopRePracticeRecording = (index: number) => {
    mediaRecorderRef.current?.stop();
  };

  const getRePracticeFeedback = async (index: number) => {
    const item = analysis[index];
    if (!item.rePracticeTranscript) return;

    setIsLoading(true);
    try {
      const feedback = await compareAndFeedback(item.polished, item.rePracticeTranscript);
      setAnalysis(prev => prev.map((it, i) => i === index ? { ...it, rePracticeFeedback: feedback } : it));
    } catch (error) {
      handleAIError(error, '获取反馈失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 针对全篇的重新录音逻辑
  const startOverallRePracticeRecording = async () => {
    if (!overallAnalysis) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    const recognition = new ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript;
      setOverallAnalysis(prev => prev ? { ...prev, rePracticeTranscript: result } : null);
    };

    mediaRecorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      setOverallAnalysis(prev => prev ? { ...prev, userAudioUrl: audioUrl, isRecording: false } : null);
    };

    setOverallAnalysis(prev => prev ? { ...prev, isRecording: true, rePracticeTranscript: '' } : null);
    mediaRecorder.start();
    recognition.start();
  };

  const stopOverallRePracticeRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const getOverallRePracticeFeedback = async () => {
    if (!overallAnalysis || !overallAnalysis.rePracticeTranscript) return;
    setIsLoading(true);
    try {
      const feedback = await compareAndFeedback(overallAnalysis.fullPolishedAnswer, overallAnalysis.rePracticeTranscript);
      setOverallAnalysis(prev => prev ? { ...prev, rePracticeFeedback: feedback } : null);
    } catch (error) {
      handleAIError(error, '获取反馈失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 进入追问环节
  const goToFollowUp = async () => {
    if (!transcript.trim()) {
      alert('请先回答当前问题，再进入追问环节哦');
      return;
    }
    setIsLoading(true);
    try {
      const question = await generateFollowUp(selectedQuestion!.text, transcript);
      setFollowUpQuestion(question);
      setStep('FOLLOWUP');
    } catch (error) {
      handleAIError(error, '生成追问失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 完成练习并生成报告
  const finishPractice = async () => {
    setIsLoading(true);
    try {
      const fullConversation = `Interviewer: ${selectedQuestion?.text}\nCandidate: ${transcript}\nInterviewer (Follow-up): ${followUpQuestion}\nCandidate: ${followUpAnswer}`;
      const result = await generateFeedback(selectedQuestion!.text, fullConversation);
      setFeedback(result);
      setStep('REPORT');
    } catch (error) {
      handleAIError(error, '生成报告失败');
    } finally {
      setIsLoading(false);
    }
  };

  // --- 渲染页面 ---

  // --- 子组件 ---
  const InteractiveText = ({ text, context }: { text: string, context: string }) => {
    return (
      <div className="relative">
        <div className="text-indigo-900 font-medium text-lg leading-relaxed flex flex-wrap">
          {text.split(' ').map((word, i) => (
            <WordLookup 
              key={i} 
              word={word} 
              context={context} 
              cache={wordCache}
              onCacheUpdate={(w, info) => setWordCache(prev => ({ ...prev, [w]: info }))}
            />
          ))}
        </div>
      </div>
    );
  };

  const LanguageToggle = () => (
    <div className="flex items-center gap-4 mb-8">
      <div className="flex bg-slate-100 p-1 rounded-xl">
        <button 
          onClick={() => setLangMode('en-US')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${langMode === 'en-US' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          纯英文模式
        </button>
        <button 
          onClick={() => setLangMode('zh-CN')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${langMode === 'zh-CN' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          中英混合模式
        </button>
      </div>
      <div className="h-4 w-px bg-slate-200" />
      <p className="text-[10px] text-slate-400 font-medium">
        {langMode === 'en-US' ? '💡 建议在练习英文回答时使用' : '💡 建议在说不出英文需中文辅助时使用'}
      </p>
    </div>
  );

  // 1. 首页
  const renderHome = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-indigo-100 p-4 rounded-full mb-6"
      >
        <Sparkles className="w-12 h-12 text-indigo-600" />
      </motion.div>
      <h1 className="text-4xl font-bold text-slate-900 mb-4">InterviewAce</h1>
      <p className="text-xl text-slate-600 mb-12 max-w-md">
        你的 AI 英语面试教练。通过真实的模拟对话，让你的表达更地道、更自信。
      </p>
      <button 
        onClick={() => setStep('SELECT')}
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-semibold text-lg shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
      >
        开始练习 <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  // 2. 题目选择页
  const renderSelect = () => (
    <div className="max-w-2xl mx-auto py-12 px-6">
      <button onClick={() => setStep('HOME')} className="flex items-center text-slate-500 mb-8 hover:text-indigo-600 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回首页
      </button>
      <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">选择一个面试题目</h2>
      <div className="space-y-4">
        {QUESTIONS.map((q) => (
          <button
            key={q.id}
            onClick={() => { setSelectedQuestion(q); setStep('PRACTICE'); }}
            className="w-full text-left p-6 bg-white border border-slate-200 rounded-2xl hover:border-indigo-500 hover:shadow-md transition-all group"
          >
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{q.text}</h3>
                <p className="text-slate-500 text-sm mt-1">{q.description}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // 3. 录音练习页
  const [showTips, setShowTips] = useState(false);

  const renderPractice = () => (
    <div className="max-w-2xl mx-auto py-12 px-6 flex flex-col items-center">
      <div className="w-full flex justify-start mb-8">
        <button onClick={() => setStep('SELECT')} className="flex items-center text-slate-500 hover:text-indigo-600 transition-colors">
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回上一页
        </button>
      </div>
      <div className="text-center mb-8">
        <span className="bg-indigo-50 text-indigo-600 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">当前题目</span>
        <h2 className="text-3xl font-bold text-slate-900 mt-4">{selectedQuestion?.text}</h2>
      </div>

      {/* AI 定制入口 */}
      <button 
        onClick={startCustomization}
        className="w-full mb-6 p-6 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-3xl text-white flex items-center justify-between shadow-lg shadow-indigo-100 hover:scale-[1.02] transition-transform group"
      >
        <div className="flex items-center gap-4">
          <div className="bg-white/20 p-3 rounded-2xl">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="text-left">
            <h4 className="font-bold text-lg">没思路？让 AI 帮你定制回答</h4>
            <p className="text-indigo-100 text-sm">通过简单的对话，生成属于你的专属面试答案</p>
          </div>
        </div>
        <ChevronRight className="w-6 h-6 text-white/50 group-hover:translate-x-1 transition-transform" />
      </button>

      {/* 可折叠的回答思路提示区 */}
      <div className="w-full mb-12">
        <button 
          onClick={() => setShowTips(!showTips)}
          className="w-full flex items-center justify-between p-6 bg-white border border-indigo-100 rounded-3xl shadow-sm hover:bg-indigo-50/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-indigo-600">
            <Lightbulb className="w-5 h-5" />
            <span className="font-bold">回答思路与提示</span>
          </div>
          <ChevronRight className={`w-5 h-5 text-indigo-400 transition-transform ${showTips ? 'rotate-90' : ''}`} />
        </button>
        
        <AnimatePresence>
          {showTips && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-6 bg-white border-x border-b border-indigo-50 rounded-b-3xl -mt-4 pt-10">
                <ul className="space-y-3">
                  {selectedQuestion?.tips.map((tip, i) => (
                    <li key={i} className="flex gap-3 text-slate-600 text-sm leading-relaxed">
                      <div className="mt-1 bg-indigo-50 p-0.5 rounded-full h-fit">
                        <Info className="w-3 h-3 text-indigo-400" />
                      </div>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <LanguageToggle />

      <div className="flex flex-col items-center gap-8 mt-8 w-full">
        {!isRecording ? (
          <div className="flex flex-col items-center gap-6 w-full">
            <button 
              onClick={() => startVoiceInput('PRACTICE')}
              className="w-24 h-24 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-indigo-200 hover:scale-105 transition-transform"
            >
              <Mic className="w-10 h-10" />
            </button>
            <p className="text-slate-400 font-medium text-lg">
              {transcript ? '点击按钮重新录制' : '点击按钮开始录音回答'}
            </p>

            {transcript && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full flex flex-col items-center gap-6"
              >
                <div className="p-6 bg-white rounded-2xl border-2 border-indigo-100 shadow-xl shadow-indigo-50/50 max-w-lg w-full relative">
                  <div className="absolute -top-3 left-6 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
                    已完成转录
                  </div>
                  <p className="text-slate-700 font-medium leading-relaxed">
                    <span className="text-indigo-400 text-2xl font-serif mr-1">“</span>
                    {transcript}
                    <span className="text-indigo-400 text-2xl font-serif ml-1">”</span>
                  </p>
                </div>

                <button 
                  onClick={startAnalysis}
                  className="w-full max-w-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  完成回答，开始逐句分析 <ChevronRight className="w-5 h-5" />
                </button>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <button 
              onClick={stopVoiceInput}
              className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center text-white shadow-xl shadow-red-200 animate-pulse"
            >
              <Square className="w-10 h-10" />
            </button>
            <p className="text-slate-400 font-medium text-lg flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
              正在录音，请回答...
            </p>

            {transcript && (
              <div className="p-6 bg-white rounded-2xl border-2 border-indigo-100 shadow-xl shadow-indigo-50/50 max-w-lg w-full relative">
                <div className="absolute -top-3 left-6 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
                  实时转录中
                </div>
                <p className="text-slate-700 font-medium leading-relaxed opacity-60">
                  {transcript}...
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // 3.5 定制化流程页
  const renderCustomize = () => (
    <div className="max-w-2xl mx-auto py-12 px-6">
      <button onClick={() => setStep('PRACTICE')} className="flex items-center text-slate-500 mb-8 hover:text-indigo-600 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回上一页
      </button>

      <div className="mb-10 p-6 bg-slate-50 rounded-3xl border border-slate-100">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">当前面试题目</span>
        <h3 className="text-xl font-bold text-slate-800">{selectedQuestion?.text}</h3>
      </div>
      
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-indigo-100 p-2 rounded-xl">
            <Sparkles className="w-6 h-6 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">AI 定制化回答</h2>
        </div>
        <p className="text-slate-500">回答以下几个问题，AI 将为你生成一份完美的个性化面试答案。</p>
      </div>

      <motion.div 
        key={currentCustomIndex}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-white border border-indigo-100 rounded-3xl p-8 shadow-sm"
      >
        <div className="mb-8">
          <LanguageToggle />
          <span className="text-indigo-500 font-bold text-xs uppercase tracking-widest">问题 {currentCustomIndex + 1} / {customQuestions.length}</span>
          <h3 className="text-xl font-bold text-slate-800 mt-2">{customQuestions[currentCustomIndex]}</h3>
        </div>

        <div className="flex flex-col items-center gap-4 bg-slate-50 rounded-2xl p-8 mb-6 border border-dashed border-indigo-200">
          {!isRecording ? (
            <button 
              onClick={() => startVoiceInput('CUSTOMIZE')}
              className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-100 hover:scale-105 transition-transform"
            >
              <Mic className="w-6 h-6" />
            </button>
          ) : (
            <button 
              onClick={stopVoiceInput}
              className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-red-100 animate-pulse"
            >
              <Square className="w-6 h-6" />
            </button>
          )}
          <p className="text-slate-400 text-sm font-medium flex items-center gap-2">
            {isRecording ? (
              <>
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                正在听取你的回答...
              </>
            ) : '点击麦克风开始语音回答'}
          </p>
          {customInput && (
            <div className="mt-4 p-4 bg-white rounded-xl border border-indigo-50 w-full">
              <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest block mb-1">当前输入</span>
              <p className="text-indigo-600 italic text-sm leading-relaxed">"{customInput}"</p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button 
            onClick={handleCustomAnswerSubmit}
            disabled={!customInput.trim()}
            className="bg-indigo-600 disabled:bg-slate-300 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all"
          >
            {currentCustomIndex < customQuestions.length - 1 ? '下一个问题' : '生成我的专属答案'} 
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
  // 4. 逐句分析页
  const renderAnalysis = () => (
    <div className="max-w-3xl mx-auto py-12 px-6 pb-32">
      <button onClick={() => setStep('PRACTICE')} className="flex items-center text-slate-500 mb-8 hover:text-indigo-600 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回上一页
      </button>

      <div className="mb-10 p-6 bg-slate-50 rounded-3xl border border-slate-100">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">当前面试题目</span>
        <h3 className="text-xl font-bold text-slate-800">{selectedQuestion?.text}</h3>
      </div>

      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-slate-900">表达优化建议</h2>
        <button 
          onClick={goToFollowUp}
          className="bg-indigo-600 text-white px-6 py-2 rounded-full font-medium flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          进入追问 <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-8">
        {analysis.map((item, idx) => (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={idx} 
            className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            {/* 原句展示 */}
            <div className="p-6 border-b border-slate-50">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">你的原句</span>
              <p className="text-slate-600 italic">"{item.original}"</p>
            </div>

            {/* 地道改写 (示例回答) */}
            <div className="p-6 bg-indigo-50/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">地道示例回答</span>
                <button 
                  onClick={() => playPolishedAudio(item.polished)}
                  className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-bold text-xs bg-white px-3 py-1.5 rounded-full shadow-sm border border-indigo-50"
                >
                  {audioState.isPlaying && audioState.currentText === item.polished ? (
                    <><Pause className="w-3.5 h-3.5" /> 暂停</>
                  ) : (
                    <><Volume2 className="w-3.5 h-3.5" /> 听示例</>
                  )}
                </button>
              </div>
              <div className="mb-4">
                <InteractiveText text={item.polished} context={selectedQuestion?.text || ''} />
              </div>
              
              <div className="flex gap-2 items-start mb-6">
                <div className="bg-indigo-100 p-1 rounded mt-0.5">
                  <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                </div>
                <p className="text-slate-500 text-sm leading-relaxed">{item.explanation}</p>
              </div>

              {/* 模仿练习区 */}
              <div className="mt-6 pt-6 border-t border-indigo-100/50">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold text-slate-500">模仿练习</span>
                  <div className="flex gap-2">
                    {item.userAudioUrl && (
                      <button 
                        onClick={() => new Audio(item.userAudioUrl).play()}
                        className="flex items-center gap-1.5 text-slate-600 hover:text-slate-700 font-bold text-xs bg-white px-3 py-1.5 rounded-full shadow-sm"
                      >
                        <Play className="w-3.5 h-3.5" /> 回听自己
                      </button>
                    )}
                    {!item.isRecording ? (
                      <button 
                        onClick={() => startRePracticeRecording(idx)}
                        className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-bold text-xs bg-white px-3 py-1.5 rounded-full shadow-sm border border-indigo-100"
                      >
                        <Mic className="w-3.5 h-3.5" /> 开始录音
                      </button>
                    ) : (
                      <button 
                        onClick={() => stopRePracticeRecording(idx)}
                        className="flex items-center gap-1.5 text-red-600 hover:text-red-700 font-bold text-xs bg-red-50 px-3 py-1.5 rounded-full shadow-sm animate-pulse"
                      >
                        <Square className="w-3.5 h-3.5" /> 停止录音
                      </button>
                    )}
                  </div>
                </div>

                {item.rePracticeTranscript && (
                  <div className="bg-white/60 p-4 rounded-2xl mb-4 border border-indigo-50">
                    <p className="text-slate-600 text-sm italic">"{item.rePracticeTranscript}"</p>
                    <button 
                      onClick={() => getRePracticeFeedback(idx)}
                      className="mt-3 text-indigo-600 font-bold text-xs flex items-center gap-1 hover:underline"
                    >
                      <RefreshCw className="w-3 h-3" /> 进阶指南
                    </button>
                  </div>
                )}

                {item.rePracticeFeedback && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-sky-500 text-white p-4 rounded-2xl text-sm leading-relaxed shadow-lg shadow-sky-100"
                  >
                    <div className="flex items-center gap-2 mb-1 opacity-80">
                      <History className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">进阶指南：语音语调建议</span>
                    </div>
                    {item.rePracticeFeedback}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* 全篇评价与建议 */}
      {overallAnalysis && (
        <div className="mt-16 pt-16 border-t border-slate-200">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-indigo-600 p-2 rounded-xl">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">全篇综合评价</h2>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm mb-8">
            <p className="text-slate-700 text-lg leading-relaxed mb-8">{overallAnalysis.evaluation}</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {overallAnalysis.suggestions.map((s, i) => (
                <div key={i} className="flex gap-3 bg-slate-50 p-4 rounded-2xl">
                  <div className="bg-indigo-100 p-1 rounded h-fit mt-0.5">
                    <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                  </div>
                  <p className="text-slate-600 text-sm">{s}</p>
                </div>
              ))}
            </div>

            {/* 完整示例回答 */}
            <div className="bg-indigo-50/50 rounded-3xl p-8 border border-indigo-100">
              <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">完整地道示例回答</span>
                <button 
                  onClick={() => playPolishedAudio(overallAnalysis.fullPolishedAnswer)}
                  className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-bold text-xs bg-white px-4 py-2 rounded-full shadow-sm border border-indigo-50"
                >
                  {audioState.isPlaying && audioState.currentText === overallAnalysis.fullPolishedAnswer ? (
                    <><Pause className="w-4 h-4" /> 暂停</>
                  ) : (
                    <><Volume2 className="w-4 h-4" /> 听完整示例</>
                  )}
                </button>
              </div>
              <div className="mb-8">
                <InteractiveText text={overallAnalysis.fullPolishedAnswer} context={selectedQuestion?.text || ''} />
              </div>

              {/* 全篇模仿练习 */}
              <div className="pt-8 border-t border-indigo-100">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-xs font-bold text-slate-500">全篇模仿练习</span>
                  <div className="flex gap-3">
                    {overallAnalysis.userAudioUrl && (
                      <button 
                        onClick={() => new Audio(overallAnalysis.userAudioUrl).play()}
                        className="flex items-center gap-1.5 text-slate-600 hover:text-slate-700 font-bold text-xs bg-white px-4 py-2 rounded-full shadow-sm"
                      >
                        <Play className="w-4 h-4" /> 回听自己
                      </button>
                    )}
                    {!overallAnalysis.isRecording ? (
                      <button 
                        onClick={startOverallRePracticeRecording}
                        className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-bold text-xs bg-white px-4 py-2 rounded-full shadow-sm border border-indigo-100"
                      >
                        <Mic className="w-4 h-4" /> 开始录音
                      </button>
                    ) : (
                      <button 
                        onClick={stopOverallRePracticeRecording}
                        className="flex items-center gap-1.5 text-red-600 hover:text-red-700 font-bold text-xs bg-red-50 px-4 py-2 rounded-full shadow-sm animate-pulse"
                      >
                        <Square className="w-4 h-4" /> 停止录音
                      </button>
                    )}
                  </div>
                </div>

                {overallAnalysis.rePracticeTranscript && (
                  <div className="bg-white/80 p-6 rounded-2xl mb-6 border border-indigo-50">
                    <p className="text-slate-600 italic">"{overallAnalysis.rePracticeTranscript}"</p>
                    <button 
                      onClick={getOverallRePracticeFeedback}
                      className="mt-4 text-indigo-600 font-bold text-sm flex items-center gap-1 hover:underline"
                    >
                      <RefreshCw className="w-4 h-4" /> 进阶指南
                    </button>
                  </div>
                )}

                {overallAnalysis.rePracticeFeedback && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-sky-500 text-white p-6 rounded-3xl leading-relaxed shadow-xl shadow-sky-100"
                  >
                    <div className="flex items-center gap-2 mb-2 opacity-80">
                      <History className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">进阶指南：语音语调建议</span>
                    </div>
                    {overallAnalysis.rePracticeFeedback}
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 进阶指南：语音语调建议 */}
      <div className="mt-16 bg-white border border-indigo-100 rounded-3xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-100 p-2 rounded-xl">
            <Lightbulb className="w-6 h-6 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">进阶指南：如何让你的英语更地道？</h2>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /> 语音语调 (Intonation)
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              面试中，语调的起伏能展现你的自信。尝试使用“降调”来结束陈述句，显得坚定；在列举时使用“升调”，在最后一项使用“降调”。
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /> 连读与弱读 (Linking)
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              不要逐字发音。学会将辅音与元元音连接（如 "Check it out"），并弱读虚词（如 "of", "to", "and"），这会让你的语速更自然。
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /> 关键词重音 (Stress)
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              重读你想要强调的关键词（如成就、技能、动词），而轻读背景信息。这能引导面试官关注你的核心优势。
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /> 停顿艺术 (Pausing)
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              在表达重要观点前稍作停顿，或者在长句中按意群停顿。这不仅给了你思考的时间，也让听者更容易消化你的内容。
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // 5. AI 追问页
  const renderFollowUp = () => (
    <div className="max-w-2xl mx-auto py-12 px-6">
      <button onClick={() => setStep('ANALYSIS')} className="flex items-center text-slate-500 mb-8 hover:text-indigo-600 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回上一页
      </button>

      <div className="mb-8 p-6 bg-slate-50 rounded-3xl border border-slate-100">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">当前面试题目</span>
        <h3 className="text-lg font-bold text-slate-700">{selectedQuestion?.text}</h3>
      </div>

      <div className="bg-indigo-600 rounded-3xl p-8 text-white mb-8 shadow-xl shadow-indigo-100 relative overflow-hidden">
        <MessageSquare className="absolute -right-4 -bottom-4 w-32 h-32 opacity-10" />
        <span className="text-indigo-200 text-xs font-bold uppercase tracking-widest">面试官追问</span>
        <h3 className="text-2xl font-bold mt-4 leading-tight">{followUpQuestion}</h3>
      </div>

      <LanguageToggle />

      <div className="flex flex-col items-center gap-4 bg-white border-2 border-slate-200 rounded-3xl p-12 mb-8 shadow-sm">
        {!isRecording ? (
          <button 
            onClick={() => startVoiceInput('FOLLOWUP')}
            className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-indigo-100 hover:scale-105 transition-transform"
          >
            <Mic className="w-8 h-8" />
          </button>
        ) : (
          <button 
            onClick={stopVoiceInput}
            className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center text-white shadow-xl shadow-red-100 animate-pulse"
          >
            <Square className="w-8 h-8" />
          </button>
        )}
        <p className="text-slate-400 font-medium flex items-center gap-2">
          {isRecording ? (
            <>
              <span className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
              正在录音，请回答追问...
            </>
          ) : '点击按钮开始语音回答'}
        </p>
        {followUpAnswer && (
          <div className="mt-6 p-6 bg-indigo-50/30 rounded-2xl border border-indigo-100 w-full">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-2">你的回答</span>
            <p className="text-indigo-900 italic leading-relaxed">"{followUpAnswer}"</p>
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <button 
          onClick={finishPractice}
          disabled={!followUpAnswer.trim()}
          className="bg-indigo-600 disabled:bg-slate-300 text-white px-12 py-4 rounded-2xl font-bold text-lg shadow-lg hover:bg-indigo-700 transition-all"
        >
          完成练习并查看报告
        </button>
      </div>
    </div>
  );

  // 6. 结果报告页
  const renderReport = () => (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <button onClick={() => setStep('FOLLOWUP')} className="flex items-center text-slate-500 mb-8 hover:text-indigo-600 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回上一页
      </button>

      <div className="mb-10 p-6 bg-slate-50 rounded-3xl border border-slate-100">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">当前面试题目</span>
        <h3 className="text-xl font-bold text-slate-800">{selectedQuestion?.text}</h3>
      </div>

      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-slate-900">练习报告</h2>
        <p className="text-slate-500 mt-2">做得好！这是你本次练习的详细反馈。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 flex flex-col items-center justify-center">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-100" />
              <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={364} strokeDashoffset={364 - (364 * (feedback?.totalScore || 0)) / 100} className="text-indigo-600 transition-all duration-1000" />
            </svg>
            <span className="absolute text-3xl font-black text-slate-900">{feedback?.totalScore}</span>
          </div>
          <p className="mt-4 font-bold text-slate-400 uppercase tracking-widest text-xs">总分</p>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-200 space-y-4">
          {[
            { label: '流畅度', val: feedback?.scores.fluency },
            { label: '自然度', val: feedback?.scores.naturalness },
            { label: '准确度', val: feedback?.scores.accuracy },
            { label: '完整度', val: feedback?.scores.completeness },
          ].map((s, i) => (
            <div key={i}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-slate-600">{s.label}</span>
                <span className="font-bold text-slate-900">{s.val}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${s.val}%` }}
                  className="bg-indigo-500 h-full" 
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6 mb-12">
        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
          <h4 className="font-bold text-emerald-900 flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5" /> 本次优点
          </h4>
          <ul className="list-disc list-inside space-y-2 text-emerald-800">
            {feedback?.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>

        <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100">
          <h4 className="font-bold text-amber-900 flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5" /> 待提升点
          </h4>
          <ul className="list-disc list-inside space-y-2 text-amber-800">
            {feedback?.improvements.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>

        <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
          <h4 className="font-bold text-indigo-900 flex items-center gap-2 mb-4">
            <RotateCcw className="w-5 h-5" /> 下次建议
          </h4>
          <p className="text-indigo-800 leading-relaxed">{feedback?.suggestions}</p>
        </div>
      </div>

      <div className="flex justify-center">
        <button 
          onClick={() => setStep('HOME')}
          className="bg-slate-900 text-white px-12 py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all"
        >
          返回首页
        </button>
      </div>
    </div>
  );

  // --- 主渲染逻辑 ---
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* 全局加载遮罩 */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center"
          >
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-600 font-medium">AI 正在思考中...</p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="container mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'HOME' && renderHome()}
            {step === 'SELECT' && renderSelect()}
            {step === 'PRACTICE' && renderPractice()}
            {step === 'CUSTOMIZE' && renderCustomize()}
            {step === 'ANALYSIS' && renderAnalysis()}
            {step === 'FOLLOWUP' && renderFollowUp()}
            {step === 'REPORT' && renderReport()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- 子组件：单词查询 ---
const WordLookup = ({ word, context, cache, onCacheUpdate }: { 
  word: string; 
  context: string; 
  cache: Record<string, WordInfo>;
  onCacheUpdate: (word: string, info: WordInfo) => void;
  key?: React.Key;
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  // 清理单词，移除标点符号
  const cleanWord = word.replace(/[.,!?;:()"]/g, '');

  const handleMouseEnter = () => {
    setShowTooltip(true);
    
    // 只有长度大于 2 的单词才查询
    if (cleanWord.length <= 2 || !/^[a-zA-Z]+$/.test(cleanWord)) return;

    // 如果缓存中已有，直接结束
    if (cache[cleanWord]) return;

    // 增加 200ms 防抖，避免鼠标划过时频繁触发
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const info = await getWordDefinition(cleanWord, context);
        onCacheUpdate(cleanWord, info);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const playWord = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) return;
    setIsPlaying(true);
    try {
      const base64 = await textToSpeech(cleanWord);
      if (base64) {
        const audio = new Audio(`data:audio/wav;base64,${base64}`);
        audio.onended = () => setIsPlaying(false);
        await audio.play();
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    }
  };

  return (
    <span 
      className="relative inline-block group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={`cursor-help transition-all duration-200 rounded px-0.5 ${showTooltip ? 'text-indigo-600 bg-indigo-50' : 'hover:text-indigo-600 hover:bg-indigo-50'}`}>
        {word}
      </span>
      
      <AnimatePresence>
        {showTooltip && cleanWord.length > 2 && /^[a-zA-Z]+$/.test(cleanWord) && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 w-60 p-4 bg-slate-900 text-white rounded-2xl shadow-2xl pointer-events-auto"
          >
            {loading ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">AI 词典查询中...</span>
              </div>
            ) : cache[cleanWord] ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-white">{cleanWord}</span>
                    <span className="text-[10px] text-indigo-300 font-mono mt-0.5">{cache[cleanWord].phonetic}</span>
                  </div>
                  <button 
                    onClick={playWord}
                    disabled={isPlaying}
                    className={`p-2 rounded-full transition-all ${isPlaying ? 'bg-indigo-500 text-white' : 'bg-white/10 hover:bg-white/20 text-indigo-300'}`}
                    title="点击发音"
                  >
                    {isPlaying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="h-px bg-white/10" />
                <p className="text-xs leading-relaxed text-slate-300 font-medium">{cache[cleanWord].definition}</p>
              </div>
            ) : (
              <span className="text-[10px] opacity-50 italic">未找到释义</span>
            )}
            {/* 小箭头 */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-slate-900" />
          </motion.div>
        )}
      </AnimatePresence>
      {/* 单词间的空格 */}
      <span className="select-none">&nbsp;</span>
    </span>
  );
};
