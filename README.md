# AgentHub

AgentHub is the shared home for AI reviewers, coding and maintenance agents, prompts, and tool configuration used across VanillaIceCube repositories. This repository currently contains its GitHub configuration. The existing agents continue to run in their original repositories during setup. [Migration tracker](https://github.com/VanillaIceCube/infrastructure/issues/194)

Track work on the [Detailed Kanban View](https://github.com/VanillaIceCube/agent-hub/issues/views/MDQ6VmlldzM0NDg3). The board groups open issues by status and issue type.

Pull requests run workflow linting, CodeQL, dependency review, and Gitleaks. CodeQL also scans `main` on push and daily. It scans Actions workflows now and includes Python and JavaScript/TypeScript when those files are added. [Actions](https://github.com/VanillaIceCube/agent-hub/actions)
