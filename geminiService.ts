
import { GoogleGenAI } from "@google/genai";
import { Message } from "./types";

// Note: GoogleGenAI is instantiated per-call to ensure fresh configuration (e.g. API keys)

export const getSmartReply = async (messages: Message[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const context = messages.slice(-5).map(m => `${m.senderId}: ${m.text}`).join('\n');
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Based on the following chat context, suggest a short, conversational, and natural smart reply. Return only the reply text, no quotes or metadata.\n\nContext:\n${context}`,
    config: {
      temperature: 0.7,
      maxOutputTokens: 100,
      // When setting maxOutputTokens, a thinkingBudget must be set to reserve tokens for output
      thinkingConfig: { thinkingBudget: 50 },
    }
  });
  return response.text || "";
};

export const chatWithAssistant = async (prompt: string, history: Message[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  // Map conversation history to Gemini parts format for contextual awareness
  const chatHistory = history.map(m => ({
    role: m.senderId === 'fluxur-ai' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', // Using Pro for complex reasoning tasks
    contents: [...chatHistory, { role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: "You are Fluxur, a highly intelligent and helpful personal assistant integrated into a messenger app. Your tone is professional yet friendly, futuristic, and efficient. You help users with tasks, answer questions, and provide insights.",
    }
  });

  return response.text || "I'm sorry, I couldn't process that.";
};

export const summarizeConversation = async (messages: Message[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const text = messages.map(m => `${m.senderId}: ${m.text}`).join('\n');
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Summarize the following chat conversation into a concise paragraph of 2-3 sentences:\n\n${text}`,
  });
  return response.text || "No summary available.";
};
