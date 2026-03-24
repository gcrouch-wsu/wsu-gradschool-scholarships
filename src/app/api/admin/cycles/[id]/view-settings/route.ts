import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        "Blind review is now configured in the reviewer form builder. Use the Blind column there instead.",
    },
    { status: 410 }
  );
}
