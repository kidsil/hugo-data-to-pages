# Hugo Data to Pages

Allows for generating pages (or any archetypes) from data (json/yaml) on [Hugo](https://github.com/gohugoio/hugo).
Related to issues [#140](https://github.com/gohugoio/hugo/issues/140) and [5074](https://github.com/gohugoio/hugo/issues/5074).

## Getting Started

This script is a simple wrapper that:
- Generates the pages under your content folder
- Runs Hugo
- And finally, removes the generated pages

The entire script is in `hugo.js`, the `example/` is just an example hugo site.

### Prerequisites

- hugo
- node & npm

### Installing & Running

- Run `npm install` to install dependencies
- Run `node hugo.js` to build
- (optional) Run `chmod +x hugo.js` to allow for direct execution, i.e. `./hugo.js`
- Go to `localhost:1313` to see links to the generated pages

#### Commands

There are 3 available commands:

- `./hugo.js` (basically hugo build to public directory)
- `./hugo.js generate` (only generate folders/files from data, same as above but without executing hugo build)
- `./hugo.js server` (basically hugo server, with cleanup on exit)
- `./hugo.js clean` (trigger cleanup in case the script didn't remove the generated folders)

Flags:
- `-c FILE.json` or `--configFile FILE.json` flag to override default config (check hugoConfig-example.json)
- `-f` or `--force` flag to skip folder removal prompts (be careful with this one!)

#### Notes

- The config file path is relative to the directory you run the script from.
- Hugo is expected on your `PATH`; otherwise set `hugoPath` in the config file.
- Only `.json`, `.yml`, `.yaml` and `.toml` files in the data folder are read, anything else is skipped.
- Every page `path` must be unique, stay inside the content folder and not sit inside another generated page. A page is never generated over a folder that already exists.
- Generated folders are tracked in `.hugo-data-to-pages.json` (in the Hugo root) until they are cleaned up, so add the file to your `.gitignore`. Cleanup only removes folders listed there, and leaves a folder alone if anything in it changed since it was generated.
- Without a terminal to confirm on (CI, pipes) nothing is removed unless you pass `--force`.
- Upgrading from an older version: run `clean` with the old version first (or delete the generated folders by hand), as folders generated before the tracking file existed are not recognised.

## Author

[kidsil](https://github.com/kidsil)

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details