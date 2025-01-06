// app/api/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Environment variable cleaning function
const cleanEnvVar = (value: string | undefined): string => {
  return value?.replace(/\r/g, "").trim() ?? "";
};

// Initialize environment variables
const STRIPE_SECRET_KEY = cleanEnvVar(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = cleanEnvVar(process.env.STRIPE_WEBHOOK_SECRET);
const SUPABASE_URL = cleanEnvVar(process.env.SUPABASE_URL);
const SUPABASE_ANON_KEY = cleanEnvVar(process.env.SUPABASE_ANON_KEY);

// Initialize Stripe
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia",
});

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Optional: Log environment variables for debugging
if (process.env.NODE_ENV === "development") {
  console.log({
    supabase_url: SUPABASE_URL,
    supabase_anon: SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY: STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
  });
}

// Plan map for subscriptions
const planMap: Record<string, { name: string; credits: number }> = {
  price_1QdFN7IvZBeqKnwP0Hs7sIoI: { name: "gold", credits: 3000 },
  price_1QdZAbIvZBeqKnwPP6Fv2zK1: { name: "diamond", credits: 100000 },
  price_1QdZAeIvZBeqKnwP9vmmaAkW: { name: "elite", credits: 500000 },
};

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const headersList = headers();
    const sig = headersList.get("stripe-signature");

    if (!sig) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    // Verify the webhook signature
    const stripeEvent = stripe.webhooks.constructEvent(
      body,
      sig,
      STRIPE_WEBHOOK_SECRET
    );

    console.log("Received Stripe webhook event:", stripeEvent.type);

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id
        );
        const priceId = lineItems.data[0]?.price?.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };

        if (!session?.customer_details?.email) {
          throw new Error("Customer email is missing");
        }

        const { data, error } = await supabase
          .from("users")
          .update({
            stripe_customer_id: session.customer,
            subscription_status: "active",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .eq("email", session.customer_details.email);

        if (error) {
          console.error("Error updating user subscription:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated user subscription:", data);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = stripeEvent.data.object as Stripe.Subscription;

        const { error } = await supabase
          .from("users")
          .update({
            subscription_status: "inactive",
            plan: "free",
            credits: 1000,
            subscription_updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          console.error("Error updating user subscription:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully deactivated subscription");
        break;
      }

      case "customer.subscription.updated": {
        const subscription = stripeEvent.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0]?.price.id;
        const plan = planMap[priceId || ""] || { name: "free", credits: 1000 };

        const { data, error } = await supabase
          .from("users")
          .update({
            subscription_status:
              subscription.status === "active" ? "active" : "inactive",
            plan: plan.name,
            credits: plan.credits,
            subscription_updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          console.error("Error updating user subscription:", error);
          throw new Error("Failed to update user subscription");
        }

        console.log("Successfully updated subscription:", data);
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
