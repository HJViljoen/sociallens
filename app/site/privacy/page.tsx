import type { Metadata } from 'next'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = {
  title: 'Privacy · Verbatim',
  description: 'What Verbatim collects, why, how long it is kept, and how to have it removed.',
}

const CONTACT = 'heinrichjviljoen@gmail.com'  // A rights channel that does not receive mail is worse than none: this is
// the address that actually reaches a human today. Change it only to another
// mailbox someone reads.

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="23 August 2026">
      <p>
        Verbatim reads public conversation on social platforms so a brand can understand what its
        market is saying. This page says exactly what that means for the people whose comments we
        read, and for the people who use the product.
      </p>

      <h2>Who we are</h2>
      <p>
        Verbatim is operated from the Western Cape, South Africa. For questions, corrections or
        removal requests, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We answer within 30
        days, and we action removal requests within 7.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Public posts and comments.</strong> Videos, captions, comment text, like and
          comment counts, post dates, the account names that posted them, and the display name or
          handle attached to a public comment, from TikTok, YouTube, Instagram and Reddit. We
          collect this through third-party scraping and platform APIs, for content matching a
          customer&rsquo;s brand, competitors and category. We do not show commenter handles inside
          the product or in the emails we send.
        </li>
        <li>
          <strong>Transcripts.</strong> Captions where a platform publishes them, or speech-to-text
          for videos that carry speech.
        </li>
        <li>
          <strong>News about the brands and categories we track.</strong> Headlines, publisher
          names, links and publication dates, from Google News RSS searches for a customer&rsquo;s
          brand, competitors and category. We keep the headline and the link. We do not fetch or
          store the article itself.
        </li>
        <li>
          <strong>Account data for our customers.</strong> Name, work email, workspace membership
          and role, and billing status.
        </li>
      </ul>
      <p>
        We do not buy data, and we set no advertising or analytics cookies. The only cookies we set
        keep a signed-in session.
      </p>
      <p>
        We do not follow individuals around the internet. There is no pixel, no tracking tag, no
        fingerprinting, and nothing that builds a picture of what any one person browses. We do
        read things published on the web: comments people posted in public, and journalism written
        about the brands we track. That is a different activity from following a person, and we
        think the difference is worth stating plainly rather than leaving you to guess which one we
        meant.
      </p>

      <h2>Why we may do this</h2>
      <p>
        For public posts and comments, our lawful basis is legitimate interests: understanding
        publicly expressed opinion about a product or category so a business can respond to it.
        We balance that against your interests by keeping the analysis at the level of themes rather
        than individuals, by not building profiles of individual commenters, and by not publishing
        commenter handles inside the product or in the emails we send. You can object at any time
        using the address above.
      </p>
      <p>
        For customer account data, the basis is the contract with that customer.
      </p>

      <h2>Special categories</h2>
      <p>
        Some categories we work in are health adjacent. Where a public comment reveals something
        about a person&rsquo;s health, we treat it as manifestly made public by that person, we use
        it only in aggregate, and we do not attach it to an identifiable individual in any surface
        of the product. Insights about who commenters are, their circumstances or location, are
        reported as counts, never as quotes.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Raw platform payloads: 30 days, then deleted automatically.</li>
        <li>News headlines and links: kept with the customer&rsquo;s workspace, deleted with it.</li>
        <li>Prompt and response bodies in our AI audit log: 30 days, then stripped to metadata.</li>
        <li>Comment text and the analysis built from it: for as long as the customer&rsquo;s workspace is active, then deleted with the workspace.</li>
        <li>
          YouTube comments and video statistics: re-checked against YouTube at least every 30 days.
          Anything deleted or hidden on YouTube is deleted here too, together with any quote of it.
        </li>
      </ul>

      <h2>Who else touches it</h2>
      <p>
        We use processors to run the service: Supabase (database), Vercel (hosting), Inngest
        (job orchestration), OpenAI (analysis), Apify (collection), Resend (email) and Stripe
        (billing). They act on our instructions only. Some process data outside South Africa and
        the EEA, under the standard contractual clauses.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask what we hold about you, ask us to correct or delete it, or object to our
        processing. Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with the handle and platform
        and we will remove the comments tied to it, and any quote of them, within 7 days, and make
        sure they are not collected again. You can also complain to your data protection authority,
        or in South Africa to the Information Regulator.
      </p>

      <h2>YouTube</h2>
      <p>
        Verbatim uses YouTube API Services. By using it you also accept the{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>,
        and Google&rsquo;s{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{' '}
        describes how Google handles data. You can revoke our access to your data through{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google security settings</a>.
      </p>
    </LegalPage>
  )
}
