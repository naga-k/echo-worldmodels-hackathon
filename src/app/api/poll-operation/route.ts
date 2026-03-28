import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const operationId = request.nextUrl.searchParams.get("operationId");

  if (!operationId) {
    return NextResponse.json(
      { error: "Missing 'operationId' parameter" },
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
      `https://api.worldlabs.ai/marble/v1/operations/${operationId}`,
      {
        headers: {
          "WLT-Api-Key": apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Poll error:", response.status, errorText);
      return NextResponse.json(
        { error: `Poll error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json(
      { error: "Failed to poll operation" },
      { status: 500 }
    );
  }
}
