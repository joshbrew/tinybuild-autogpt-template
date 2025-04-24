## Build and run

First, in this directory, run: 

`npm install`

Also: `npm i -g concurrently` for useful multi-process cli tool we use.

Then with [`tinybuild`](https://github.com/joshbrew/tinybuild) installed globally (`npm i -g tinybuild`) run: 

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

## Prompting Tips

### [Example Video](https://youtu.be/84Pggzt8A0c)

Tell it to read and add features to e.g. index.css or index.js and to use script-based web components or a react root rather than editing index.html. This will stop it from screwing up the imports too much since our build environment has preset targets for bundling. 

Remind it to check itself when it makes errors, it can often correct the code back. 

It can also npm install for you or re-prompt itself if explicitly instructed to just run free on the tasks you give it.

### Contribute!

Please submit your own samples or vibe code some self-improvements to this overall interface yourself. 

I keep coming up with more ideas as I run into missing functionality e.g. screencapping or getting the live built code for self-debugging against a lack of visual feedback. Sometimes this requires a fresh pass to reorganize the backend code so the app can upgrade itself. Lots of possibilities, hmm..

Make a pull request, github issue, or email me :-)

### Some joke code written entirely by GPT with CSS, Canvas, and ThreeJS animations (including installing its own dependencies):
![image](https://github.com/user-attachments/assets/4d74c8da-828b-4feb-a882-81387c996938)

## Configuration

See [`./tinybuild.config.js`](./tinybuild.config.js) for settings. 

Add build:true for build-only, add serve:true for serve-only, or set bundle or server to false alternatively.

## TODO:

- Improve chat frontend (it's jank), 
- Explore run failures and attempt to restart. It is a persistent bug in the assistants cloud api but you can just say try again until it goes through.
- Add ability for gpt to restart the concurrent environment if the gpt dev needs modifying? >_> <_< maybe a bad idea idk
- Add screencapping ability (expensive!!) for more automation, better test console logging, help GPT systematize its approach to editing and debugging better to take your hands off the wheel even more.


