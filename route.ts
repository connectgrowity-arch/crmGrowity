import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      code,
      student,
      mobile,
      whatsapp,
      email,
      location,
      district,
      course,
      contact_time,
      notes,
    } = body;

    if (!student || !mobile) {
      return NextResponse.json(
        { error: "Student name and mobile number are required." },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "CRM database service client is unavailable." },
        { status: 500, headers: corsHeaders }
      );
    }

    // 1. Get Growity Academy Vertical ID
    const { data: vertical } = await supabase
      .from("verticals")
      .select("id")
      .eq("code", "ACD")
      .maybeSingle();

    if (!vertical) {
      return NextResponse.json(
        { error: "Growity Academy (ACD) vertical not found." },
        { status: 500, headers: corsHeaders }
      );
    }

    // 2. Check for duplicate student phone
    const cleanPhone = (mobile || "").replace(/\D/g, "").slice(-10);
    if (cleanPhone) {
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("vertical_id", vertical.id)
        .ilike("phone", `%${cleanPhone}%`)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { duplicate: true, message: "This student has already been referred." },
          { status: 200, headers: corsHeaders }
        );
      }
    }

    // 3. Get initial lead stage for ACD
    const { data: stage } = await supabase
      .from("lead_stages")
      .select("id")
      .eq("vertical_id", vertical.id)
      .order("stage_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    // 4. Assign an active owner
    let ownerId: string | null = null;
    const { data: userVert } = await supabase
      .from("user_verticals")
      .select("user_id, profiles!inner(id, is_active)")
      .eq("vertical_id", vertical.id)
      .eq("profiles.is_active", true)
      .limit(1)
      .maybeSingle();

    if (userVert?.user_id) {
      ownerId = userVert.user_id;
    } else {
      const { data: firstActive } = await supabase
        .from("profiles")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      ownerId = firstActive?.id || null;
    }

    if (!ownerId) {
      return NextResponse.json(
        { error: "No active CRM user available to assign lead." },
        { status: 500, headers: corsHeaders }
      );
    }

    // 5. Build lead notes
    const formattedNotes = [
      code ? `[Referral Partner ID: ${code}]` : "[Referral Partner: None]",
      whatsapp ? `WhatsApp: ${whatsapp}` : null,
      location || district ? `Location: ${[location, district].filter(Boolean).join(", ")}` : null,
      contact_time ? `Preferred Contact Time: ${contact_time}` : null,
      notes ? `Notes: ${notes}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    // 6. Insert new lead
    const { data: lead, error: insertError } = await supabase
      .from("leads")
      .insert({
        vertical_id: vertical.id,
        owner_id: ownerId,
        stage_id: stage?.id || null,
        title: `Student Referral: ${student}`,
        contact_name: student,
        email: email || null,
        phone: mobile,
        course_interest: course || "General Inquiry",
        source: "referral",
        notes: formattedNotes,
        status: "open",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Lead insert error:", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        id: lead.id,
        message: "Referral submitted successfully into Growity CRM.",
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("API /referrals error:", err);
    return NextResponse.json(
      { error: (err instanceof Error ? err.message : String(err)) || "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
