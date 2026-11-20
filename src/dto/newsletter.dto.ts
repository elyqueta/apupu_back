import { NewsletterSubscription } from '../types/newsletter.types';

/** Vista administrativa de uma subscrição de novidades. */
export interface NewsletterDto {
  id: string;
  email: string;
  created_at: string;
}

export function toNewsletterDto(subscription: NewsletterSubscription): NewsletterDto {
  return {
    id: subscription.id,
    email: subscription.email,
    created_at: subscription.createdAt.toISOString(),
  };
}
