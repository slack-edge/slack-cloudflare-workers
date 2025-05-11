## Simple App

If you haven't set up your project yet, please go through the steps [here](./index.md) first. With the project set up, it's time to dive into the code. Open `src/index.ts` and modify the source code as follows:

```typescript
import {
  SlackApp,
  SlackEdgeAppEnv,
  isPostedMessageEvent,
} from "slack-cloudflare-workers";

export default {
  async fetch(
    request: Request,
    env: SlackEdgeAppEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const app = new SlackApp({ env })
      // When the pattern matches, the framework automatically acknowledges the request
      .event("app_mention", async ({ context }) => {
        // You can do any time-consuming tasks here!
        await context.client.chat.postMessage({
          channel: context.channelId,
          text: `:wave: <@${context.userId}> what's up?`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:wave: <@${context.userId}> what's up?`,
              },
              accessory: {
                type: "button",
                text: { type: "plain_text", text: "Click Me" },
                value: "click_me_123",
                action_id: "button-action",
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "plain_text",
                  text: "This message is posted by an app running on Cloudflare Workers",
                },
              ],
            },
          ],
        });
      })
      .message("Hello", async ({ context }) => {
        await context.say({ text: "Hey!" });
      })
      .event("message", async ({ payload }) => {
        if (isPostedMessageEvent(payload)) {
          console.log(`New message: ${payload.text}`);
        }
      })
      .action(
        "button-action",
        async () => {}, // Mus complete this within 3 seconds
        async ({ context }) => {
          // You can do any time-consuming tasks here!
          const { respond } = context;
          if (respond) {
            await respond({ text: "Now working on it ..." });
            await sleep(5);
            await respond({ text: "It's done :white_check_mark:" });
          }
        }
      )
      .command(
        "/hello-cf-workers",
        async () => "Thanks!", // Must complete this within 3 seconds
        async ({ context }) => {
          // You can do any time-consuming tasks here!
          await context.respond({ text: "What's up?" });
        }
      )
      .shortcut(
        "hey-cf-workers",
        async () => {}, // Must complete this within 3 seconds
        async ({ context, payload }) => {
          // You can do any time-consuming tasks here!
          await context.client.views.open({
            // The trigger_id needs to be used within 3 seconds
            trigger_id: payload.trigger_id,
            view: {
              type: "modal",
              callback_id: "modal",
              title: { type: "plain_text", text: "My App" },
              submit: { type: "plain_text", text: "Submit" },
              close: { type: "plain_text", text: "Cancel" },
              blocks: [],
            },
          });
        }
      )
      .viewSubmission(
        "modal",
        // Must respond within 3 seconds to update/close the opening modal
        async () => {
          return { response_action: "clear" };
        },
        async (req) => {
          // Except updating the modal view using response_action,
          // you can asynchronously do any tasks here!
        }
      );
    return await app.run(request, ctx);
  },
};

const sleep = (seconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};
```

Create a new file named `.dev.vars` and include the valid variables:

```
SLACK_SIGNING_SECRET=....
SLACK_BOT_TOKEN=xoxb-...
SLACK_LOGGING_LEVEL=DEBUG
```

When you run `wrangler dev --port 3000`, your app process spins up, and it starts handling HTTP requests at `http://localhost:3000/slack/events`.

Now, it's time to run the app using the [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/tunnel-guide/local/) proxy. Once the tunnel is connected to your local app, a public URL like `https://system-guam-mpg-adequate.trycloudflare.com` should be available to use for Slack's Request URLs.

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel --url http://localhost:3000
```

Did the app work for you? :tada: Congratulations! Your first Slack app built with Cloudflare Workers is now up and running! Add more handlers to the app to help your teammates become even more productive!

Once you finish working on the app development, now you can deploy the app to Cloudflare infrastructure.

```bash
wrangler deploy
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_BOT_TOKEN
```

If you need more information about Cloudflare app development, please refer to [Cloudflare's documents](https://developers.cloudflare.com/workers/platform/deployments/).
