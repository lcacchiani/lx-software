export function ProjectsPage() {
  const projects = [
    {
      name: 'Public Website Infrastructure',
      tech: 'AWS CDK, CloudFront, S3',
      description:
        'Scalable and secure static site hosting with global CDN distribution',
    },
    {
      name: 'Modern Web Applications',
      tech: 'React, TypeScript, Vite',
      description:
        'Fast, type-safe web applications with modern tooling and best practices',
    },
    {
      name: 'Content Management Systems',
      tech: 'Headless CMS, REST APIs',
      description:
        'Flexible content solutions that separate presentation from data',
    },
    {
      name: 'CI/CD Pipelines',
      tech: 'GitHub Actions, OIDC',
      description:
        'Automated deployment workflows with secure authentication',
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Projects</h1>
        <p className="text-muted" style={{ fontSize: '1rem', maxWidth: '700px' }}>
          Selected work and capabilities in web development and infrastructure
        </p>
      </div>

      <div>
        {projects.map((project, index) => (
          <div
            key={project.name}
            style={{
              marginBottom: '2.5rem',
              paddingBottom: '2rem',
              borderBottom:
                index < projects.length - 1 ? '1px solid #006600' : 'none',
            }}
          >
            <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
              {project.name}
            </h2>
            <div
              className="text-dim"
              style={{ fontSize: '0.875rem', marginBottom: '1rem' }}
            >
              [{project.tech}]
            </div>
            <p className="text-muted" style={{ fontSize: '1rem', maxWidth: '700px' }}>
              {project.description}
            </p>
          </div>
        ))}
      </div>

      <div className="text-dim" style={{ marginTop: '3rem', fontSize: '0.875rem' }}>
        &gt; Interested in working together?{' '}
        <a href="/contact" style={{ color: '#00ff00' }}>
          Get in touch
        </a>
      </div>
    </div>
  )
}
