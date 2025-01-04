import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({ message: "good" });
  } catch (e) {
    return NextResponse.json({ message: e });
  }
}
