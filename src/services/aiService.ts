import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function getClientAIInsights(clientData: any) {
  const prompt = `
    Eres un analista experto en ecommerce y marketing digital.
    Analiza los siguientes KPIs del cliente y devuelve un diagnóstico estructurado en formato JSON.
    
    KPIs: ${JSON.stringify(clientData)}
    
    Format:
    {
      "health_diagnostic": "Summary of status",
      "critical_alerts": [
        {"title": "...", "description": "...", "priority": "high|medium"}
      ],
      "growth_opportunities": [
        {"title": "...", "description": "...", "impact": "high"}
      ],
      "content_ideas": ["idea1", "idea2"],
      "executive_summary": "Paragraph for the client report"
    }
  `;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: prompt,
    });
    return JSON.parse(result.text || "{}");
  } catch (error) {
    console.error("Error generating insights:", error);
    return null;
  }
}
