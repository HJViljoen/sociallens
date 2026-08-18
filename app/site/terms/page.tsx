import type { Metadata } from 'next'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = {
  title: 'Terms · Verbatim',
  description: 'The terms you agree to when you use Verbatim.',
}

const CONTACT = 'heinrichjviljoen@gmail.com'  // A rights channel that does not receive mail is worse than none: this is
// the address that actually reaches a human today. Change it only to another
// mailbox someone reads.

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="18 August 2026">
      <p>
        These terms cover your use of Verbatim. Using the product means you accept them. If you are
        agreeing on behalf of a company, you are confirming you may bind that company.
      </p>

      <h2>What the service is</h2>
      <p>
        Verbatim collects public conversation about your brand, your competitors and your category,
        and returns themes, evidence and recommendations drawn from it. Coverage is a sample, not a
        census: we read what our collection reaches, and we say so on every surface that reports a
        number.
      </p>

      <h2>What we do not promise</h2>
      <p>
        We do not promise completeness, and we do not promise that a recommendation will work. The
        analysis is generated with the help of language models, checked against verbatim source
        text. Use it as input to your judgement, not as a replacement for it. Nothing here is legal,
        medical or financial advice.
      </p>

      <h2>Your account</h2>
      <p>
        Keep your password to yourself and tell us if you think it has been used by someone else.
        You are responsible for what happens in your workspace. Do not use Verbatim to identify,
        target or contact individual commenters at scale, and do not re-publish the source data we
        show you as if it were your own dataset.
      </p>

      <h2>Fees</h2>
      <p>
        Paid workspaces are billed at the price agreed with you. Design-partner and complimentary
        workspaces are free until we tell you otherwise, with notice before anything changes.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop at any time and we will delete your workspace and its data on request. We can
        suspend a workspace that is being used against these terms, or that is not paid for, and we
        will tell you why.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability is limited to what you paid us in the
        three months before the claim. We are not liable for indirect or consequential loss.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms. Material changes get an email to workspace owners before they
        take effect. Questions go to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. South African law
        applies.
      </p>
    </LegalPage>
  )
}
