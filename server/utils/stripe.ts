import config from '../config';
import Stripe from 'stripe';
import { getUserByEmail } from './firebase';

const stripe = new Stripe(config.STRIPE_SECRET_KEY as string, {
  apiVersion: '2020-08-27',
});

export async function getCustomerByEmail(email: string) {
  if (!config.STRIPE_SECRET_KEY) {
    return undefined;
  }
  const customer = await stripe.customers.list({
    email,
    expand: ['data.subscriptions'],
  });
  return customer?.data[0];
}

export async function getIsSubscriberByEmail(email: string | undefined) {
  if (!config.STRIPE_SECRET_KEY) {
    // If Stripe isn't set up assume everyone is a subscriber
    return true;
  }
  if (!email) {
    return false;
  }

  // Check if user registered with email/password - if so, they get Plus automatically
  try {
    const user = await getUserByEmail(email);
    if (user && user.providerData && user.providerData.length > 0) {
      // Check if the user has email/password provider (password provider)
      const hasEmailProvider = user.providerData.some(
        (provider) => provider.providerId === 'password',
      );
      if (hasEmailProvider) {
        console.log(
          `[PLUS] Granting automatic Plus status to email-registered user: ${email}`,
        );
        return true;
      } else {
        console.log(
          `[PLUS] User ${email} uses providers: ${user.providerData.map((p) => p.providerId).join(', ')} - checking Stripe`,
        );
      }
    } else {
      console.log(
        `[PLUS] No provider data found for user: ${email} - checking Stripe`,
      );
    }
  } catch (error) {
    console.warn(`[PLUS] Error checking user provider for ${email}:`, error);
  }

  // Fall back to checking Stripe subscription
  const customer = await getCustomerByEmail(email);
  const isSubscriber = Boolean(
    customer?.subscriptions?.data?.find((sub) => sub?.status === 'active'),
  );

  if (isSubscriber) {
    console.log(`[PLUS] User ${email} has active Stripe subscription`);
  } else {
    console.log(`[PLUS] User ${email} does not have Plus access`);
  }

  return isSubscriber;
}

export async function createSelfServicePortal(
  customerId: string,
  returnUrl: string,
) {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function getAllCustomers() {
  const result = [];
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    result.push(customer);
  }
  return result;
}

export async function getAllActiveSubscriptions() {
  const result = [];
  for await (const sub of stripe.subscriptions.list({
    limit: 100,
    status: 'active',
  })) {
    result.push(sub);
  }
  return result;
}
