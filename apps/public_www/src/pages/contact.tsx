export function ContactPage() {
  return (
    <div className="fade-in">
      <h1 className="page-title">contact</h1>
      <p className="page-description">
        Interested in working together? Get in touch and we will respond within 
        two business days.
      </p>

      <hr />

      <div className="contact-grid stagger-in">
        <div className="contact-row">
          <span className="contact-label">email</span>
          <span className="contact-value">
            <a href="mailto:hello@lx-software.com">hello@lx-software.com</a>
          </span>
        </div>

        <div className="contact-row">
          <span className="contact-label">location</span>
          <span className="contact-value">Hong Kong</span>
        </div>

        <div className="contact-row">
          <span className="contact-label">github</span>
          <span className="contact-value">
            <a href="https://github.com/lx-software" target="_blank" rel="noopener noreferrer">
              github.com/lx-software
            </a>
          </span>
        </div>

        <div className="contact-row">
          <span className="contact-label">response</span>
          <span className="contact-value">within 2 business days</span>
        </div>
      </div>

      <hr />

      <p className="page-description" style={{ marginTop: '1rem' }}>
        We are always open to discussing new projects, creative ideas, or 
        opportunities to be part of something meaningful. Whether you have a 
        question or just want to say hello, feel free to reach out.
      </p>
    </div>
  )
}
