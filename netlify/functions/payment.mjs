import Stripe from "stripe";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return Response.json({
      error: "Stripe is not configured yet. Add your STRIPE_SECRET_KEY in the Netlify dashboard under Site Settings > Environment Variables.",
      needsSetup: true,
    }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { amount, currency, description, customer_email, card } = body;

    if (!amount || amount < 50) {
      return Response.json({ error: "Minimum order is $0.50" }, { status: 400 });
    }

    const stripe = new Stripe(stripeKey);

    // Create a PaymentIntent for the charge
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency || "usd",
      description: description || "Session Zero order",
      receipt_email: customer_email,
      payment_method_data: {
        type: "card",
        card: {
          number: card.number,
          exp_month: parseInt(card.exp.split("/")[0]),
          exp_year: parseInt("20" + card.exp.split("/")[1]),
          cvc: card.cvc,
        },
        billing_details: {
          name: card.name,
          email: customer_email,
        },
      },
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    if (paymentIntent.status === "succeeded") {
      return Response.json({
        success: true,
        chargeId: paymentIntent.id,
        amount: paymentIntent.amount,
      });
    } else {
      return Response.json({
        error: "Payment not completed. Status: " + paymentIntent.status,
      }, { status: 400 });
    }
  } catch (err) {
    const message = err.type === "StripeCardError"
      ? err.message
      : "Payment processing error. Please try again.";

    return Response.json({ error: message }, { status: 400 });
  }
};
