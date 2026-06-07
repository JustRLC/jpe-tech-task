### Intentions 

First, when I get tasked into a project specifically to roll out an app into an environment, what I look out for:

- Cost optimisations - reduce image sizes, and CD build times.x
- Security - Image version used to run the app, environment isolation (DEV > TEST > PROD), and IAM privileges for IaC and App runtime in Cloud.
- Reliability - MultiAZ where needed using Cloud resources, health checks, and ingress load balancing.
- Performance efficiency - Looking out for right-sized compute, and caching.

Also, it's also looking out for what tools are used. So as of doing my discovery I can already see this is a lightweight NodeJS app, Docker build is used to build the image, Github Actions for CI/CD, and Terraform for AWS provisioning. This is so I can work with their strengths as a tool because all tools have a slight differentiation in costs efficiencies and best performance optimisations.

All my actions are based on deploying this as if this was production.

The flow I do is: 

1. Test function of the app and check if it follows security standards
2. Observe Dockerfile to ensure best practices e.g. Security practices, optimisations, and cost efficiencies. If changes are applied, test the image before proceeding to next steps. 
3. Same for CI/CD, looking into the pipeline to apply any misconfiguration, optimisations / cost efficiencies because SaaS CI/CD in particular charge for how long your job executions are. Often enough, if your execution fails then additional costs will be in play. 
4. Terraform - Ensure resource efficiencies are applied to IaC, and checking it follows good security practices based on Cloud IAM and networking. 

### Testing the app

As I'm a bit familiar with NodeJS, I had a look into the design of this app. 

To start it off, I'm doing the following in numerical order so that I'm not wasting time on trying to run the app.

1. `npm ci` - I used `ci` because the repository already consisted of `packaged-lock.json` file. Therefore, when it was last tested by the developer, I'd know I can replicate those exact packages onto my machine.
2. `npm test` - In package.json, it has a script with `npm test` using jest, incredibly lightweight and tests the javascript. So no changes required there and this gives great opportunity for me to test the app function before start.
3. `npm start` - In package.json, there is already a start script for `src/server.js` so no changes needed there. 

After that, the application checked out ok and was able to give me the expected output. Contents of the page from root (`/`) and request / response from `/health`

### Changes made

#### 1. Release status dashboard app

###### The app endpoint for `/api/config`

I reviewed `src/server.js` because application-level issues can undermine otherwise good CI/CD or infrastructure controls. I found that `/api/config` exposes runtime configuration, including port, environment, and debug state. This information is not required by users and could help an attacker fingerprint the service. I removed or restricted this endpoint so it is unavailable in production. Added the following since a `constant` already has a string of `development` 

```javascript
app.get("/api/config", (req, res) => {
  if (environment === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ appName, environment });
});
```

I removed port and debug status, and then I ran `NODE_ENV=production npm start` to check my changes worked to avoid human error. 

###### The app nodeJS version

Whilst noticing the app is using node v20 which has been EoL since 30th April, 2026, I used https://nodejs.org/en/about/eol  to best determine the next suitable LTS version. It ended up being v24. I chose this because their support for v24 EoS is 2030 and because the app were using packages didn't seem to depend on v20, v24 with LTS was the best option. 

To test the app's function, I used `nvm` (Node Version Manager). I did the following: 

`nvm use 24` - to set Node version
`node -v` - to check node version 
`npm ci`  - install packages from package-lock.json
`npm test` - Jest testing 
`npm start` - for quick testing of the app

All came out successful.

#### 2. Docker build 

###### Security

Observing the Dockerfile contents, the biggest alarm was that node was using `node:20` and other security concerns 

- Size of image will become an issue when using this in the cloud due to usage. So I chose alpine for the enhanced security, faster pull, low disk/network usage, and less noisy CVEs which is great if you want great security compliance; this will help achieve potential clients.

- Great security concerns with Node v20 with use this website EoL reference: https://nodejs.org/en/about/eol - Node.js v20 reached end of life on April 30, 2026. The application was using an older Node runtime. I upgraded it to Node 24 LTS rather than latest. Using an LTS release provides a stable, supported runtime while avoiding the unpredictability of automatically adopting future major Node releases. This improves build reproducibility and reduces deployment risk.

- Wanted to avoid running the app as a root user, so I added `USER node` so that the attacker has fewer things to do if the container gets compromised 

###### CI 

Observing the build, I wanted to look at it from a CI perspective. The focus was to look at it from a security, cost, and efficiency perspective.

- Added `.dockerignore`  to reduce build time which helps with CI efficiency and costs. 
- I replaced `npm install` with `npm ci --omit=dev` in the Docker build. `npm ci` ensures deterministic installs using the committed lockfile, improving reproducibility across environments. The `--omit=dev` flag excludes development-only packages such as testing libraries from the production image, resulting in a smaller, faster, and more secure container. 
- Added `ENV NODE_ENV=production` to avoid accidentally running with development behaviour as this would assist with the logic changes I made regarding  `GET /api/config`
- Healthcheck was added so that platforms can check the app is unhealthy rather than just considered as a `running` container. 
- Replaced CMD with `["node", "src/server.js"]` to keep it direct and simple. From a Linux point of view, using `npm` is an extra process layer. This also mitigates confusion if `package.json` for whatever reason doesn't contain the script for `npm start`. 


With all these changes being made, I tested this on the local machine before pushing to github which came out successfully. The final image remains over 100MB because the official Node 24 Alpine base image contains the Node.js runtime and npm tooling. The application itself only adds a few MB checking the `docker history`, so further meaningful reductions would require a more specialised/distroless runtime image or compiling/bundling the app differently. For this task, the current image is a reasonable balance between simplicity, maintainability, and size.


#### 3. GitHub Actions - CI/CD - flow changes

I have not worked with GitHub Actions but my experience with Bitbucket and Jenkins CI/CD will treat this as a standard protocol. With the assistance of AI models, I got it summarise the current pipeline workflow and the workflow syntax referenced from: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax.

This gave me an understanding on how I want to approach this workflow so that I'm able to read it like a book and to also ask the prompt to apply the following for my flow: 

1. Pull Request / Push to main  
2. Checkout repo  
3. Setup NodeJS  
4. Install dependencies with npm ci  
5. Run tests  
6. Build and scan Docker image
7. Run Terraform checks only  
8. Deploy script only on main

I added a Docker image vulnerability scan before deployment. Since the application is containerised, the pipeline should fail if the built image contains high or critical vulnerabilities. This helps catch insecure base images or vulnerable dependencies before release.

I included Terraform static checks in CI, such as `terraform fmt`, `init -backend=false`, and `validate`, because the infrastructure is part of the review. However, I would not run `terraform plan` or `terraform apply` because the task explicitly states that AWS credentials are not required and the infrastructure does not need to be deployed.

I added the following for efficiency and reliability.
```yaml
concurrency:  
	group: ci-cd-${{ github.ref }}  
	cancel-in-progress: true
```

It prevents multiple workflows from running simultaneously for the same branch. If several commits are pushed in quick succession, older runs are cancelled and only the latest commit is built and deployed. This reduces wasted CI resources and prevents deploying outdated code.


### Observations  - Infra - Terraform AWS -

> Please review it as part of the task and include any observations, concerns, or improvements in your notes.

On the basis of reviewing the `/Infra` directory as directed in the task, this is what I got:

##### Observations: 
- Instance type is oversized for this lightweight app 
- EBS size is probably unnecessary unless you plan to hold logs locally. 
- S3 seems to hardcoded, which can be a problem for two reasons:
	- S3 bucket names are globally unique, so the name may already exist
	- There is little control on the name in Terraform. So if you including Terraform as part of the workflow job, it will likely fail provisioning. 
- Lack of S3 bucket hardening
- The Terraform configuration exposes SSH (port 22) publicly via `0.0.0.0/0`. I see no reason SSH to be added as a protocol as part of the VPC security group. If this is for an admin to access the EC2 to apply a standard setup, I would suggest using the AWS console or controlling this via Configuration Management (Ansible / Saltstack).
- AMI ID is using variable, but again, it seems to have a hardcoded name like the S3 bucket. I suggest this to be controlled dynamically. 
- Port `3000` is also open to `0.0.0.0/0` publicly. I suggest putting this behind a gateway, remove CIDR block and control the gateway to the app via security group.
- The security group allows unrestricted egress traffic to `0.0.0.0/0`. If the instance were compromised, unrestricted egress could make data exfiltration or command-and-control traffic easier.

##### Improvements / Concerns: 
- I'd expect production Terraform states to use a remote backend as S3 with DynamoDB locking to allow for collaborative work and changes. Without this, you will likely lose the current state or cause confusion among the team. 
- Suggestion is to look at reducing to 10GB with encryption enabled
- Set variables on S3 bucket name and AMI ID so that these can be easily controlled via CI/CD via environment variables.
- As already mentioned in the observation, avoid opening SSH unless there is a great justification for it. If it was to complete a standard build, I suggest either using AWS Console or using Configuration Management.
- Put the app behind the gateway for security coverage, and high availability of the app for ingress traffic
- Consider the appropriate size of the instance of this app.
- For egress traffic on this EC2,  I would initially restrict outbound access to required protocols such as HTTPS and, in a more production-ready setup, route AWS service access through VPC endpoints and minimise direct internet egress. I likely suspect egress coverage will be needed the following:
	- OS updates  
	- pulling Docker images  
	- CloudWatch logs  
	- S3 artifacts  
	- AWS APIs
- Hardening S3 bucket with the following: 
	- Versioning
	- Public access blocks
	- Encryption with AES256

The Terraform seems to provision a working AWS EC2-based deployment, but it is not production-hardened. The main concerns are public SSH access, direct public exposure of the application port, oversized compute and storage, limited S3 hardening, and unclear state management. For this task, I would prioritise restricting network access, reducing resource sizes, encrypting storage, adding log retention/lifecycle controls, and considering a managed container platform such as ECS Fargate or App Runner to reduce overhead, help with scalability, cutdown maintainability, and hardened security.

### Additional Improvements

I think with the changes made as part of improvement and a lot of the Terraform provisioning improvements I suggested, I can only suggest: 

- In a production environment, I would introduce GitHub Environments with DEV → TEST → PROD promotion and manual approval gates before production deployment. This provides safer releases, traceability, and rollback opportunities.

### Goal

I prioritised changes that improve repeatability, security, and confidence in deployment. I upgraded the runtime to Node 24 Alpine, switched Docker and CI installs to npm ci, added a Docker build check before deployment, prevented root container execution, and added a healthcheck. I also reviewed the application and infrastructure for obvious risks, including debug/config exposure, public SSH access, and oversized infrastructure. I kept the changes small and appropriate for the scope of the task rather than redesigning the application completely.