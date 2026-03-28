import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { description } = await request.json();

  if (!description || typeof description !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'description' field" },
      { status: 400 }
    );
  }

  const apiKey = process.env.WORLD_LABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "WORLD_LABS_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://api.worldlabs.ai/marble/v1/worlds:generate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "WLT-Api-Key": apiKey,
        },
        body: JSON.stringify({
          display_name: "Generated Scene",
          world_prompt: {
            type: "text",
            text_prompt: description,
          },
          model: "Marble 0.1-mini",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("World Labs API error:", response.status, errorText);
      return NextResponse.json(
        { error: `World Labs API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("World Labs API error:", error);
    return NextResponse.json(
      { error: "Failed to generate world" },
      { status: 500 }
    );
  }
}
