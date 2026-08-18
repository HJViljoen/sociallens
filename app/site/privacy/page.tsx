import type { Metadata } from 'next'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = {
  title: 'Privacy — Verbatim',
  description: 'What Verbatim collects, why, how long it is kept, and how to have it removed.',
}

const CONTACT = 'privacy@verbatimintel.com'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="18 August 2026">
      <p>
        Verbatim reads public conversation on social platforms so a brand can understand what its
        market is saying. This page says exactly what that means for the people whose comments we
        read, and for the people who use the product.
      </p>

      <h2>Who we are</h2>
      <p>
        Verbatim is operated from the Western Cape, South Africa. For questions, corrections or
        removal requests, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We answer within 30
        days.
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
          <strong>Account data for our customers.</strong> Name, work email, workspace membership
          and role, and billing status.
        </li>
      </ul>
      <p>
        We do not buy data, we do not track you across the web, and we place no advertising or
        analytics cookies. The only cookies we set are the ones that keep a signed-in session.
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
        of the product.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Raw platform payloads: 30 days, then deleted automatically.</li>
        <li>Prompt and response bodies in our AI audit log: 30 days, then stripped to metadata.</li>
        <li>Comment text and the analysis built from it: for as long as the customer&rsquo;s workspace is active, then deleted with the workspace.</li>
        <li>
          YouTube comments: after 30 days we delete the ones we never cited, and for the ones we did
          cite we delete the commenter&rsquo;s name and keep only the sentence itself.
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
        and we will remove the comments tied to it. You can also complain to your data protection
        authority, or in South Africa to the Information Regulator.
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
