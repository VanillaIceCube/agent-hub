# Working in AgentHub

AgentHub owns agent behavior, prompts, tool access, and publishing. Infrastructure owns the shared CI, scanning, and release implementations. Each consuming repository controls its own triggers, credentials, and merge policy. [Ownership and rollout](https://github.com/VanillaIceCube/infrastructure/issues/191)

Use a pull request for changes to `main`. Keep external Actions and reusable workflows pinned to reviewed commit SHAs. Update both CodeQL action references together. Preserve the independent checks feeding `Required CI` and the trusted `Dependabot Policy` check on the pull request head.

During migration, preserve each reviewer's GitHub App identity, repository-scoped credentials, and budget. Compare results with the existing agent on the same revision, pilot with publication disabled, and cut over one authorized target at a time. The consuming repository retains control over merging and deployment. [Migration and rollback criteria](https://github.com/VanillaIceCube/infrastructure/issues/194)
