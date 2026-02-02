export function ProjectsPage() {
  return (
    <div className="fade-in">
      <h1 className="page-title">projects</h1>
      <p className="page-description">
        A selection of work we have delivered. Each project reflects our commitment 
        to clean architecture, modern tooling, and thoughtful engineering.
      </p>

      <hr />

      <div className="project-list stagger-in">
        <div className="project-card">
          <h2 className="project-title">Public Website Infrastructure</h2>
          <p className="project-description">
            A fully automated static site deployment pipeline using AWS CDK. 
            S3 hosting with CloudFront CDN, automated SSL certificates, and 
            GitHub Actions CI/CD with OIDC authentication.
          </p>
          <div className="project-tech">
            <span>aws-cdk</span>
            <span>cloudfront</span>
            <span>s3</span>
            <span>github-actions</span>
          </div>
        </div>

        <div className="project-card">
          <h2 className="project-title">React Application Framework</h2>
          <p className="project-description">
            Modern React application template with Vite, React Router, and 
            TanStack Query. Optimized for developer experience with fast HMR 
            and production builds that score 100 on Lighthouse.
          </p>
          <div className="project-tech">
            <span>react</span>
            <span>vite</span>
            <span>typescript</span>
            <span>tanstack-query</span>
          </div>
        </div>

        <div className="project-card">
          <h2 className="project-title">API Gateway & Services</h2>
          <p className="project-description">
            Serverless API infrastructure with AWS Lambda and API Gateway. 
            Type-safe handlers, automated OpenAPI documentation, and 
            comprehensive monitoring with CloudWatch.
          </p>
          <div className="project-tech">
            <span>aws-lambda</span>
            <span>api-gateway</span>
            <span>dynamodb</span>
            <span>typescript</span>
          </div>
        </div>

        <div className="project-card">
          <h2 className="project-title">DevOps Automation</h2>
          <p className="project-description">
            Infrastructure as code templates and CI/CD pipelines for rapid 
            deployment. Pre-commit hooks, automated security scanning, and 
            dependency management across multiple environments.
          </p>
          <div className="project-tech">
            <span>terraform</span>
            <span>docker</span>
            <span>github-actions</span>
            <span>checkov</span>
          </div>
        </div>
      </div>
    </div>
  )
}
