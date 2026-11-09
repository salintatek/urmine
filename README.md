# Urmine

Write Markdown. Build websites.

## Features

- Markdown to HTML
- Syntax highlighting
- CSS and JavaScript minification
- Custom HTML, CSS, and JavaScript
- Media file support
- Development server with live reload
- Customizable HTML template
- CDN integration

## Usage

```bash
# Initialize project
npx urmine

# Development server
npx urmine dev

# Build website
npx urmine build
```

## Getting Started

Create or edit Markdown files inside `app/md/`.

## App Directory

The `app/` directory contains the source files used to generate your website.

```text
app/
├── md/
│   └── index.md
├── html/
│   ├── nav.html
│   └── content.html
├── css/
│   └── style.css
├── js/
│   └── script.js
├── code/
│   └── example.js
└── media/
    └── image.png
```

### `app/md/`

Stores Markdown files that Urmine converts into HTML pages.

For example:

```text
app/md/
├── index.md
├── about.md
└── contact.md
```

Each Markdown file generates a corresponding HTML page.

### `app/html/`

Stores reusable HTML files and components.

You can insert HTML files into Markdown using placeholders:

- `{html.content}` — Inserts `app/html/content.html`.
- `{html.global.nav}` — Inserts `app/html/nav.html` globally into generated pages.

### `app/css/`

Stores custom CSS stylesheets used by your website.

For example:

```text
app/css/
└── style.css
```

### `app/js/`

Stores custom JavaScript files used by your website.

For example:

```text
app/js/
└── script.js
```

### `app/code/`

Stores code examples that can be inserted into Markdown or HTML using placeholders.

For example:

```md
{code.example.js}
```

This inserts the contents of `app/code/example.js`.

### `app/media/`

Stores media assets such as images, icons, and other files.

During the build process, these files are copied into the output directory under `media/`.

## Notes

1. `{html.global.nav}` inserts the global navigation bar from `app/html/nav.html`. Declare this placeholder only in `app/md/index.md`
2. `{html.content}` inserts the main content from `app/html/content.html`.
3. `{code.example.js}` inserts JavaScript code from `app/code/example.js`.
4. Leave a blank line between placeholders to improve Markdown readability.

## Configuration

Urmine stores its configuration files inside the `.urmine/` directory:

- `config.json` — Main project configuration, including output directory, formatting options, minification, base URL, and automatic translation settings.
- `titles.json` — Stores page titles.
- `cdn.css.json` — Stores external CSS CDN references.
- `cdn.js.json` — Stores external JavaScript CDN references.
- `cdn.highlight.json` — Stores Highlight.js CDN configuration.
- `.initialized` — Indicates that the Urmine project has been initialized.

### Urmine configuration directory

```text
.urmine/
├── config.json
├── titles.json
├── cdn.css.json
├── cdn.js.json
├── cdn.highlight.json
└── .initialized
```

**Note:** `.prettierignore` is also used by Urmine, but it stays in the project root rather than inside `.urmine/`.

## Project Structure

A typical Urmine project looks like this:

```text
project/
├── .urmine/
│   ├── config.json
│   ├── titles.json
│   ├── cdn.css.json
│   ├── cdn.js.json
│   ├── cdn.highlight.json
│   └── .initialized
├── .prettierignore
├── app/
│   ├── md/
│   ├── html/
│   ├── css/
│   ├── js/
│   ├── code/
│   └── media/
├── public/
│   └── index.html
└── dist/
```

- `.urmine/` — Stores Urmine configuration and project metadata.
- `app/` — Stores website source files.
- `public/` — Stores the main HTML template.
- `dist/` — Contains the generated website after building.
- `.prettierignore` — Defines files excluded from Prettier formatting.

## Recommendation

Keep your Markdown content, HTML components, stylesheets, scripts, code examples, and media assets organized in their respective `app/` directories.

This makes your project easier to maintain as your website grows.
