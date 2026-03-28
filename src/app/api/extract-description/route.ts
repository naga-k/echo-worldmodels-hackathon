import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  const { text } = await request.json();

  if (!text || typeof text !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'text' field" },
      { status: 400 }
    );
  }

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a spatial description extractor for 3D world generation. Given the following text, extract a concise spatial description optimized for generating a 3D scene. Focus on:
- Physical layout and dimensions
- Key objects and their positions relative to each other
- Materials, colors, and textures
- Lighting conditions and atmosphere
- Any architectural features

Return ONLY the spatial description as a single paragraph, no preamble or explanation.

Input text:
${text}`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return NextResponse.json(
        { error: "Unexpected response type from Claude" },
        { status: 500 }
      );
    }

    return NextResponse.json({ description: content.text });
  } catch (error) {
    console.error("Claude API error:", error);
    return NextResponse.json(
      { error: "Failed to extract description" },
      { status: 500 }
    );
  }
}
