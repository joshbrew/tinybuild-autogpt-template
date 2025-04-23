## Build and run

First, in this directory, run: 

`npm install`

Also: `npm i -g concurrently` for useful multi-process cli tool we use.

Then with `tinybuild` installed globally (`npm i -g tinybuild`) run: 

`npm start`

You also need to create a `.env` file and specify your OpenAI secret: 
```
OPENAI_API_KEY=sk-...
```
Additionally supported env vars (optional, defaults shown are hard coded if undefined):
```
HOST=localhost #default e.g...
PORT=3000 #default gpt port
SAVED_DIR=gpt_dev/saved #default
GPT_MODEL=gpt-4.1 #default
```
When running, navigate to:

`http://localhost:8080/gptdev` for the prompt window

The main page is found at:

`http://localhost:8080`

This will hot reload the page when scripts are updated, and css specifically is hot swapped without page reloads. This combines with esbuild's instant feedback for rapid development. GPT can use this to debug or install packages on the fly and introduce things like plotting or 3D libraries and bundle them.

And much more can be configured with the `tinybuild.config.js`

Have fun watching your website or webapp code itself! Assistant runs tend to be a bit slow depending on the model, and not all models can use assistants yet. Currently it is set to GPT-4.1 but you can just set the model from this list: https://platform.openai.com/docs/pricing

## Configuration

See [`./tinybuild.config.js`](./tinybuild.config.js) for settings. 

Add build:true for build-only, add serve:true for serve-only, or set bundle or server to false alternatively.

## TODO:

- Improve chat frontend (it's jank), 
- Explore run failures and attempt to restart.
- Add ability to restart the concurrent environment if the gpt dev needs modifying? >_> <_<

