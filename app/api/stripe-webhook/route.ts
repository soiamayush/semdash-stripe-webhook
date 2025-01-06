import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
// import { buffer } from "micro";
// import { IncomingMessage } from "http";

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-12-18.acacia", // Updated apiVersion
});


// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);
console.log("env log are here");
console.log({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stripePublish: process.env.STRIPE_PUBLISHABLE_KEY,
  stripeSecret: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
});

// CORS Headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Handle CORS preflight
export async function OPTIONS() {
  return NextResponse.json("ok", { headers: corsHeaders });
}
console.log("webhook started");
// Handle POST (Stripe webhook)
export async function POST(req: NextRequest) {
  const signature = headers().get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // const body = await buffer(req.body as unknown as IncomingMessage);
    const body = await req.text();
    // const rawBuffer = new TextEncoder().encode(rawBody);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET environment variable is not set");
    }

    // Verify the webhook signature
    const stripeEvent = stripe.webhooks.constructEvent(
      body, // Convert Uint8Array to Buffer
      signature,
      webhookSecret
    );

    console.log("Received Stripe webhook event:", stripeEvent.type);

    // Plan map for subscriptions
    const planMap: Record<string, { name: string; credits: number }> = {
      price_1QdZAXIvZBeqKnwPvCm2ZyMz: { name: "gold", credits: 7000 },
      price_1QdZAbIvZBeqKnwPP6Fv2zK1: { name: "diamond", credits: 100000 },
      price_1QdZAeIvZBeqKnwP9vmmaAkW: { name: "elite", credits: 500000 },
    };

    // Handle different event types
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        console.log("checkout completed started!!!");
        const session = stripeEvent.data.object as Stripe.Checkout.Session;

        console.log("Processing checkout session:", session.id);
        // console.log({ session });

        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id
        );
        const priceId = lineItems.data[0]?.price?.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };

        // Update user subscription in Supabase
        console.log("Customer Email:", session?.customer_details?.email);
        if (!session?.customer_details?.email) {
          throw new Error("Customer email is missing");
        }
        console.log({ email: session?.customer_details?.email });
        console.log("DB save started!!! Creation!!!!");
        console.log(
          "Customer Email in Webhook:",
          session.customer_details.email
        );

        console.log({
          stripe_customer_id: session.customer as string,
          subscription_status: "active",
          plan: plan.name,
          credits: plan.credits,
          subscription_updated_at: new Date().toISOString(),
        });
        const { data, error } = await supabase
          .from("users")
          .update({
            stripe_customer_id: session.customer as string,
            subscription_status: "active",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .ilike("email", session.customer_details.email);

        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated user subscription:", data);

        console.log({ errorUploadingDataCreation: error });
        console.log({ DatabaseUpdatedCreation: data });

        console.log("Successfully updated user subscription");
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = stripeEvent.data.object as Stripe.Subscription;
        console.log("Processing subscription deletion:", subscription.id);

        const { error } = await supabase
          .from("users")
          .update({
            subscription_status: "inactive",
            plan: "free",
            credits: 1000,
            subscription_updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", subscription.customer as string);

        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully deactivated subscription");
        break;
      }

      case "customer.subscription.updated": {
        const subscription = stripeEvent.data.object as Stripe.Subscription;

        console.log("Processing subscription update:", subscription.id);

        const priceId = subscription.items.data[0]?.price.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };
        console.log("user updation");
        console.log({
          subscription_status:
            subscription.status === "active" ? "active" : "inactive",
          plan: plan.name,
          credits: plan.credits,
          subscription_updated_at: new Date().toISOString(),
        });
        const { data, error } = await supabase
          .from("users")
          .update({
            subscription_status:
              subscription.status === "active" ? "active" : "inactive",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .ilike("stripe_customer_id", subscription.customer as string);
        console.log({ errorUploadingDataUpdation: error });
        console.log({ DatabaseUpdatedUpdation: data });
        if (error) {
          console.error("Error updating user:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated subscription");
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return NextResponse.json(
      { received: true },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400, headers: corsHeaders }
    );
  }
}
