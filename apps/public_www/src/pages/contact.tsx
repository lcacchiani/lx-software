export function ContactPage() {
  return (
    <div>
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Contact</h1>
        <p
          className="text-muted"
          style={{ fontSize: '1.1rem', maxWidth: '700px', lineHeight: '1.8' }}
        >
          Share your goals and timelines, and we will respond with a focused
          plan for your project.
        </p>
      </div>

      <div style={{ marginTop: '3rem' }}>
        <div
          style={{
            border: '1px solid #006600',
            padding: '2rem',
            maxWidth: '600px',
          }}
        >
          <h2
            className="text-dim"
            style={{ fontSize: '0.875rem', marginBottom: '2rem' }}
          >
            CONTACT INFORMATION
          </h2>

          <div style={{ fontSize: '1rem', lineHeight: '2' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div className="text-dim" style={{ fontSize: '0.875rem' }}>
                EMAIL
              </div>
              <a
                href="mailto:hello@lx-software.com"
                style={{ fontSize: '1.1rem' }}
              >
                hello@lx-software.com
              </a>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div className="text-dim" style={{ fontSize: '0.875rem' }}>
                LOCATION
              </div>
              <div style={{ fontSize: '1.1rem' }}>Hong Kong</div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div className="text-dim" style={{ fontSize: '0.875rem' }}>
                RESPONSE TIME
              </div>
              <div style={{ fontSize: '1.1rem' }}>Within 2 business days</div>
            </div>

            <div>
              <div className="text-dim" style={{ fontSize: '0.875rem' }}>
                AVAILABILITY
              </div>
              <div style={{ fontSize: '1.1rem' }}>
                Monday - Friday, 9:00 - 18:00 HKT
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="text-dim"
        style={{ marginTop: '3rem', fontSize: '0.875rem' }}
      >
        &gt; We look forward to hearing from you
        <span className="terminal-cursor">_</span>
      </div>
    </div>
  )
}
