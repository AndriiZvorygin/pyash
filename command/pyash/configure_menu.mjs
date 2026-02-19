import path from "node:path";
import readline from "node:readline/promises";

export function createConfigureMenu(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    listAgents,
    pathExists,
    resolveConfiguredAgentHouse,
    loadMatrixConfigureDefaults,
    DEFAULT_CHANNEL_AGENT_NAME,
    loadMindConfigFromSecret,
    configureMatrix,
    configureMatrixTest,
    configureMatrixDoctor,
    MATRIX_CATERER_NAME,
    configureChannelList,
    configureMind,
    configureAgent,
    configureOrchestrator,
    textOut,
    jsonOut
  } = deps;

  async function configureIntro({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const hasConfiguredAgent = async (worldRoot) => {
      const names = await listAgents({ worldRoot });
      for (const agentName of names) {
        const conductDir = path.join(resolveConfiguredAgentHouse(worldRoot, agentName), "conduct");
        if (
          await pathExists(path.join(conductDir, "managed.pya"))
          || await pathExists(path.join(conductDir, "runtime.pya"))
          || await pathExists(path.join(conductDir, "channels.pya"))
        ) {
          return true;
        }
      }
      return false;
    };
    const loadStatus = async () => {
      const channel = await loadMatrixConfigureDefaults({ rootDir, agentName: DEFAULT_CHANNEL_AGENT_NAME });
      const mind = await loadMindConfigFromSecret(rootDir);
      const worldRoot = path.join(rootDir, "world");
      return {
        channel: Boolean(channel.homeserver && channel.room),
        mind: Boolean(mind.backend && mind.host && mind.model),
        agent: await hasConfiguredAgent(worldRoot)
      };
    };
    const status = await loadStatus();

    if (json) {
      jsonOut({ ok: true, route: "configure intro", rootDir, status });
      return;
    }

    while (true) {
      const current = await loadStatus();
      const defaultChoice = !current.channel ? "1"
        : !current.mind ? "2"
          : !current.agent ? "3"
            : "4";
      let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        textOut("Pyash Configure Intro");
        textOut(`1. channel ${current.channel ? "(configured)" : "(pending)"}`);
        textOut(`2. mind ${current.mind ? "(configured)" : "(pending)"}`);
        textOut(`3. agent ${current.agent ? "(configured)" : "(pending)"}`);
        textOut("4. exit");
        const choice = (await rl.question(`Choose option [${defaultChoice}]: `)).trim() || defaultChoice;
        if (choice === "1") {
          rl.close();
          rl = null;
          await configureChannel([]);
          continue;
        }
        if (choice === "2") {
          rl.close();
          rl = null;
          await configureMind({ args: [] });
          continue;
        }
        if (choice === "3") {
          rl.close();
          rl = null;
          await configureAgent({ args: [] });
          continue;
        }
        textOut("No changes made.");
        return;
      } finally {
        try { rl?.close(); } catch {}
      }
    }
  }

  async function configureChannel(args) {
    const sub = args[0] ?? "";
    if (!sub) {
      while (true) {
        let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          textOut("Pyash Configure Channel");
          textOut("1. matrix");
          textOut("2. exit");
          const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
          if (choice === "2") {
            textOut("No changes made.");
            return;
          }
          rl.close();
          rl = null;
          await configureMatrix({ args: [] });
        } finally {
          try { rl?.close(); } catch {}
        }
      }
    }

    if (sub === "list") {
      await configureChannelList({ json: hasFlag(args, "--json") });
      return;
    }

    if (sub !== MATRIX_CATERER_NAME) {
      throw new Error(`unknown caterer: ${sub}`);
    }

    const action = args[1] ?? "";
    if (action === "test") {
      await configureMatrixTest({ args: args.slice(2) });
      return;
    }
    if (action === "doctor") {
      await configureMatrixDoctor({ args: args.slice(2) });
      return;
    }
    await configureMatrix({ args: args.slice(1) });
  }

  async function configureMenu(args) {
    const first = args[0] ?? "";
    if (first === "intro") {
      await configureIntro({ args: args.slice(1) });
      return;
    }
    if (first === "orchestrator") {
      await configureOrchestrator({ args: args.slice(1) });
      return;
    }
    if (first === "channel") {
      await configureChannel(args.slice(1));
      return;
    }
    if (first === "mind") {
      await configureMind({ args: args.slice(1) });
      return;
    }
    if (first === "agent") {
      await configureAgent({ args: args.slice(1) });
      return;
    }

    while (true) {
      let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        textOut("Pyash Configure");
        textOut("1. intro");
        textOut("2. channel");
        textOut("3. mind");
        textOut("4. agent");
        textOut("5. exit");
        const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
        if (choice === "1") {
          rl.close();
          rl = null;
          await configureIntro({ args: [] });
          continue;
        }
        if (choice === "2") {
          rl.close();
          rl = null;
          await configureChannel([]);
          continue;
        }
        if (choice === "3") {
          rl.close();
          rl = null;
          await configureMind({ args: [] });
          continue;
        }
        if (choice === "4") {
          rl.close();
          rl = null;
          await configureAgent({ args: [] });
          continue;
        }
        textOut("No changes made.");
        return;
      } finally {
        try { rl?.close(); } catch {}
      }
    }
  }

  return {
    configureIntro,
    configureChannel,
    configureMenu
  };
}
