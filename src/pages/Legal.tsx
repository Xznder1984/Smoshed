import { Link } from 'react-router-dom'
import { ageText, DETAIL_LABEL, missingLegalDetails, site } from '../lib/site'

/**
 * Terms and privacy pages.
 *
 * These describe what the code actually does: what is stored, what is public,
 * how blocking works, and what the bot is. Where a real operator detail is
 * still missing, the page says so plainly instead of showing sample text that
 * could be mistaken for a real legal notice.
 */
export function LegalPage({ section }: { section: 'terms' | 'privacy' }) {
  const missing = missingLegalDetails()

  return (
    <main className="content content-wide" id="main">
      <article className="panel prose">
        <h1>{section === 'terms' ? 'Terms of use' : 'Privacy policy'}</h1>
        {site.updated ? (
          <p className="muted">Last updated {site.updated}</p>
        ) : (
          <p className="muted">Draft — not yet in effect.</p>
        )}

        {missing.length > 0 ? (
          <div className="callout" role="note">
            <strong>This page is still a draft.</strong> It does not name{' '}
            {missing.map((key, index) => (
              <span key={key}>
                {index > 0 ? (index === missing.length - 1 ? ', or ' : ', ') : ''}
                {DETAIL_LABEL[key]}
              </span>
            ))}
            . Those details are required before this can be published as a final
            notice, because a policy that does not say who runs a service is not
            a policy anyone can rely on.
          </div>
        ) : null}

        {section === 'terms' ? <Terms /> : <Privacy />}
      </article>

      <p>
        <Link to="/">Back to the feed</Link>
      </p>
    </main>
  )
}

function Operator() {
  if (site.legalEntity) return <>{site.legalEntity}</>
  if (site.operatorName) return <>{site.operatorName}</>
  return <>the site operator (not yet named)</>
}

function Terms() {
  return (
    <>
      <h2>Who runs this</h2>
      <p>
        Smoshed is operated by <Operator />
        {site.jurisdiction ? `, under the laws of ${site.jurisdiction}` : ''}. You can reach us
        at{' '}
        {site.contactEmail ? (
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        ) : (
          'a contact address that has not been published yet'
        )}
        .
      </p>

      <h2>Your account</h2>
      <p>
        You need an account to post, reply, like, repost, or bookmark. You must be at least{' '}
        {ageText()} to create one. You are responsible for what you post, and you must not post
        content that breaks the law or harms other people.
      </p>
      <p>
        You can change your display name and bio at any time. Your handle cannot be changed,
        because other people link to it.
      </p>

      <h2>What is not allowed</h2>
      <p>Posts and accounts may be removed for:</p>
      <ul>
        <li>Spam, scams, or bulk automated posting</li>
        <li>Harassment, threats, or targeted abuse</li>
        <li>Hate speech targeting a protected group</li>
        <li>Content involving self-harm or sexual content involving minors</li>
        <li>Impersonating someone else, including Smoshed staff</li>
        <li>Deliberate misinformation presented as fact</li>
      </ul>

      <h2>Blocking and muting</h2>
      <p>
        Blocking an account hides their posts everywhere on Smoshed and stops them replying to
        you or following you. Muting is softer: their posts disappear from your own feeds, but
        they are not told. You can block Smoshed itself, which is the simplest way to stop its
        replies.
      </p>

      <h2>The Smoshed bot</h2>
      <p>
        <strong>@smosh</strong> is an automated account. Mentioning it in a post or reply asks it
        to respond. It is limited by a prompt, a set of blocked words, and rate limits, and it
        has no ability to act on your account, read your private data, or change any setting.
        Its replies are clearly marked as automated, and you can block it at any time.
      </p>
      <p>
        Because it is a language model, it can be wrong. Do not rely on anything it says.
      </p>

      <h2>Ending an account</h2>
      <p>
        You can delete your account from Settings. Deleting removes your profile, your posts,
        and your personal data permanently. Deleting your own posts is not possible, because
        replies from other people depend on them for context.
      </p>

      <h2>No warranty</h2>
      <p>
        Smoshed is provided as-is, without warranty of any kind. It may be unavailable or
        inaccurate at times. To the extent permitted by law, the operator is not liable for
        losses arising from your use of the service.
      </p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> email address, handle, display name, bio, and a
          password hash. The password itself is never stored, and the hash is deliberately slow
          to compute.
        </li>
        <li>
          <strong>Your posts:</strong> text, the time, replies and quotes, and the counts of
          likes, reposts, replies, and quotes.
        </li>
        <li>
          <strong>Your session:</strong> a random identifier in an httpOnly cookie, with a
          hashed CSRF token, the user agent, and the last time the password was confirmed.
        </li>
        <li>
          <strong>Rate limit counters:</strong> short-lived records used to slow down abuse.
        </li>
        <li>
          <strong>Moderation reports:</strong> what you reported, why, and when.
        </li>
      </ul>

      <h2>What is public</h2>
      <p>
        Your handle, display name, bio, and posts are public and visible to anyone, including
        people who are not signed in. Your email address and password hash are never public.
        Your bookmarks and notifications are private to you.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>No advertising and no third-party trackers, analytics scripts, or pixels.</li>
        <li>No selling or sharing your data.</li>
        <li>No profiling for advertising.</li>
        <li>No third-party fonts, icon sets, or CDNs loaded while you use the site.</li>
      </ul>

      <h2>Avatars</h2>
      <p>
        There is no image upload. Avatars are drawn in your browser from a random seed stored
        with your account, so no picture of you is ever uploaded, stored, or served.
      </p>

      <h2>The bot and third-party AI providers</h2>
      <p>
        If you mention @smosh, the text of your post and the surrounding conversation are sent to
        an AI provider — Groq, NVIDIA, or Ollama, depending on which is configured — to generate
        a reply. Do not include private information in a post that mentions @smosh, because it
        will leave Smoshed as part of that request. Replies are posted publicly under
        @smoshed&apos;s account.
      </p>

      <h2>Cookies</h2>
      <p>
        Smoshed sets two cookies: a session cookie that keeps you signed in, and a CSRF cookie
        that protects forms. Both are required for the site to work, neither is used for
        tracking, and neither is readable by other sites.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        Expired sessions and rate limit counters are deleted automatically. If you delete your
        account, your profile, posts, sessions, and reports are removed.
      </p>

      <h2>Your rights</h2>
      <p>
        You can download everything Smoshed holds about you from Settings, and delete your
        account from the same place. Contact us at{' '}
        {site.contactEmail ? (
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        ) : (
          'a contact address that has not been published yet'
        )}{' '}
        for anything else.
      </p>
    </>
  )
}
