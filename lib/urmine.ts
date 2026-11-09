#!/usr/bin/env node
import fs from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { exec } from 'node:child_process'
import CleanCSS from 'clean-css'
import chalk from 'chalk'
import chokidar from 'chokidar'
import hljs from 'highlight.js'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import { minify as minifyHTML } from 'html-minifier-terser'
import { minify as minifyJS } from 'terser'

// ============================================================
// Types
// ============================================================

interface UrmineConfig {
    outDir: string
    singleQuote: boolean
    copyButton: boolean
    autoTranslate: boolean
    defaultLanguage: string
    minify: boolean
    base: string | null
}

interface Titles {
    [key: string]: string
}

interface DevClient {
    res: ServerResponse
}

type CdnLinks = string[]

type FileEntry = import('node:fs').Dirent

type NodeError = NodeJS.ErrnoException

// ============================================================
// Global
// ============================================================

const devMemory = new Map<string, string>()

let globalHtml = ''

const mode = process.argv[2]

const isInit = !mode
const isDev = mode === 'dev'
const isBuild = mode === 'build'

const cwd = process.cwd()

const appDir = path.join(cwd, 'app')
const mdDir = path.join(appDir, 'md')
const cssDir = path.join(appDir, 'css')
const jsDir = path.join(appDir, 'js')
const htmlDir = path.join(appDir, 'html')
const codeDir = path.join(appDir, 'code')
const mediaDir = path.join(appDir, 'media')

const publicDir = path.join(cwd, 'public')
const templatePath = path.join(publicDir, 'index.html')

/* const configPath = path.join(cwd, 'config.json')
const titlesPath = path.join(cwd, 'titles.json')

const cdnCssPath = path.join(cwd, 'cdn.css.json')
const cdnJsPath = path.join(cwd, 'cdn.js.json')
const cdnHighlightPath = path.join(cwd, 'cdn.highlight.json')

const initFlagPath = path.join(cwd, '.initialized') */

const urmineDir = path.join(cwd, '.urmine')

const configPath = path.join(urmineDir, 'config.json')
const titlesPath = path.join(urmineDir, 'titles.json')

const cdnCssPath = path.join(urmineDir, 'cdn.css.json')
const cdnJsPath = path.join(urmineDir, 'cdn.js.json')
const cdnHighlightPath = path.join(urmineDir, 'cdn.highlight.json')

const initFlagPath = path.join(urmineDir, '.initialized')

const prettierIgnorePath = path.join(cwd, '.prettierignore')

// ============================================================
// Default content
// ============================================================

const prettierIgnoreContent = `
**/*.html
!public/index.html
!app/html/**/*.html
!app/code/**/*.html
`.trim()

const defaultMd = `
# Welcome to Urmine

A lightweight Markdown static site generator.

Write Markdown. Build websites.

## Getting Started

Create or edit Markdown files inside \`app/md/\`.
`.trim()

const staticHtml = `
<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        {base_href}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {cdn.css}
        {cdn.highlight}
        {style}
    </head>
    <body>
        {content}
        {cdn.js}
        {script}
    </body>
</html>
`.trim()

const staticCss = `
pre {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 1em;
}

pre code {
  display: block;
  width: 100%;
}

code {
  display: inline;
}

.copy-button {
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 4px 8px;
  font-size: 12px;
  color: #333;
  background-color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0,0,0,0.15);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  backdrop-filter: blur(2px);
  transition: opacity 0.2s ease-in-out, background 0.2s;
}

.copy-button:hover {
  background-color: rgba(255,255,255,1);
}

pre:hover .copy-button,
pre:focus-within .copy-button {
  opacity: 1;
}
`.trim()

const staticJs = `
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('pre').forEach(preElement => {
    const code = preElement.querySelector('code');
    if (!code) return;

    if (
      !code.classList.contains('hljs') ||
      ![...code.classList].some(cls => cls.startsWith('language-'))
    ) {
      return;
    }

    const button = document.createElement('button');
    button.innerHTML = 'Copy';
    button.className = 'copy-button';

    button.onclick = () => {
      navigator.clipboard.writeText(code.innerText).then(() => {
        button.innerHTML = 'Copied!';
        setTimeout(() => (button.innerHTML = 'Copy'), 1000);
      });
    };

    preElement.appendChild(button);
  });
});
`.trim()

function getTranslateJs(defaultLanguage: string): string {
    return `
document.addEventListener('DOMContentLoaded', () => {

  const defaultLanguage = '${defaultLanguage}';

  const browserLanguage =
    navigator.languages?.[0] ||
    navigator.language ||
    defaultLanguage;

  const targetLanguage =
    browserLanguage.split('-')[0];

  if (targetLanguage === defaultLanguage) {
    return;
  }

  if (window.__urmineTranslateLoaded) {
    return;
  }

  window.__urmineTranslateLoaded = true;

  const container = document.createElement('div');
  container.id = 'google_translate_element';
  container.style.display = 'none';

  document.body.appendChild(container);

  window.googleTranslateElementInit = function () {

    new google.translate.TranslateElement(
      {
        pageLanguage: defaultLanguage,
        autoDisplay: false
      },
      'google_translate_element'
    );

    const interval = setInterval(() => {
      const select = document.querySelector('.goog-te-combo');

      if (!select) return;

      select.value = targetLanguage;
      select.dispatchEvent(new Event('change'));

      clearInterval(interval);
    }, 500);
  };

  const script = document.createElement('script');

  script.src =
    'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';

  script.async = true;

  document.head.appendChild(script);

});
`.trim()
}

const devReloadScript = `
if (typeof EventSource !== 'undefined') {
  const es = new EventSource(window.location.origin + '/__reload');
  es.onmessage = () => location.reload();
}
`.trim()

// ============================================================
// Markdown configuration
// ============================================================

marked.use(
    markedHighlight({
        langPrefix: 'hljs language-',

        highlight(code: string, lang: string) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, {
                    language: lang,
                }).value
            }

            return hljs.highlightAuto(code).value
        },
    })
)

// ============================================================
// Utilities
// ============================================================

/* async function isFirstRun(): Promise<boolean> {
    try {
        await fs.access(initFlagPath)
        return false
    } catch {
        await fs.writeFile(initFlagPath, new Date().toISOString(), 'utf-8')

        return true
    }
} */
async function isFirstRun(): Promise<boolean> {
    await fs.mkdir(urmineDir, {
        recursive: true,
    })

    try {
        await fs.access(initFlagPath)
        return false
    } catch {
        // await fs.writeFile(initFlagPath, new Date().toISOString(), 'utf-8')
        await fs.writeFile(initFlagPath, '')

        return true
    }
}

async function isProjectInitialized(): Promise<boolean> {
    try {
        await fs.access(initFlagPath)
        return true
    } catch {
        return false
    }
}

function replaceMarkdownLinks(content: string): string {
    return content.replace(/\]\(([^)]+?)\.md\)/g, ']($1.html)')
}

function replaceHtmlLinks(content: string, basePrefix = ''): string {
    if (!basePrefix) return content

    return content.replace(
        /\b(href|src|poster)=["'](?!https?:\/\/|\/\/|#|mailto:|tel:|data:)([^"']+)["']/g,
        (match, attr: string, url: string) => {
            // Pertahankan relative path
            if (!url.startsWith('/')) {
                return match
            }

            // Hindari prefix ganda
            if (url.startsWith(`${basePrefix}/`)) {
                return match
            }

            return `${attr}="${basePrefix}${url}"`
        }
    )
}

// ============================================================
// File utilities
// ============================================================

async function readAndConcatFiles(
    dir: string,
    extFilter: string[] = []
): Promise<string> {
    try {
        const entries = await fs.readdir(dir, {
            withFileTypes: true,
        })

        const results = await Promise.all(
            entries.map(async (entry: FileEntry) => {
                const fullPath = path.join(dir, entry.name)

                if (entry.isDirectory()) {
                    return readAndConcatFiles(fullPath, extFilter)
                }

                if (
                    entry.isFile() &&
                    (extFilter.length === 0 ||
                        extFilter.includes(path.extname(entry.name)))
                ) {
                    return fs.readFile(fullPath, 'utf-8')
                }

                return ''
            })
        )

        return results.join('\n').trim()
    } catch (err) {
        if ((err as NodeError).code === 'ENOENT') {
            return ''
        }

        throw err
    }
}

async function getMarkdownFilesRecursively(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, {
        withFileTypes: true,
    })

    const files = await Promise.all(
        entries.map(async (entry: FileEntry) => {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                return getMarkdownFilesRecursively(fullPath)
            }

            if (entry.isFile() && entry.name.endsWith('.md')) {
                return fullPath
            }

            return null
        })
    )

    return files.flat().filter((file): file is string => file !== null)
}

async function getHtmlFilesRecursively(dir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(dir, {
            withFileTypes: true,
        })

        const files = await Promise.all(
            entries.map(async (entry: FileEntry) => {
                const fullPath = path.join(dir, entry.name)

                if (entry.isDirectory()) {
                    return getHtmlFilesRecursively(fullPath)
                }

                if (entry.isFile() && entry.name.endsWith('.html')) {
                    return fullPath
                }

                return null
            })
        )

        return files.flat().filter((file): file is string => file !== null)
    } catch (err) {
        if ((err as NodeError).code === 'ENOENT') {
            return []
        }

        throw err
    }
}

async function cleanFolder(
    dir: string,
    allowedExtensions: string[] = [],
    allowedFiles: string[] = []
): Promise<void> {
    try {
        const entries = await fs.readdir(dir, {
            withFileTypes: true,
        })

        for (const entry of entries) {
            const filePath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                await cleanFolder(filePath, allowedExtensions, allowedFiles)

                const remaining = await fs.readdir(filePath)

                if (remaining.length === 0) {
                    await fs.rmdir(filePath)
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase()

                if (
                    !allowedExtensions.includes(ext) &&
                    !allowedFiles.includes(entry.name)
                ) {
                    await fs.unlink(filePath)
                }
            }
        }
    } catch (err) {
        if ((err as NodeError).code !== 'ENOENT') {
            throw err
        }
    }
}

async function removeEmptyDirs(dir: string): Promise<void> {
    let entries: FileEntry[]

    try {
        entries = await fs.readdir(dir, {
            withFileTypes: true,
        })
    } catch {
        return
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const fullPath = path.join(dir, entry.name)

            await removeEmptyDirs(fullPath)
        }
    }

    const remaining = await fs.readdir(dir)

    if (remaining.length === 0) {
        await fs.rmdir(dir)
    }
}

async function cleanupAll(): Promise<void> {
    await cleanFolder(publicDir, [], ['index.html'])
    await cleanFolder(mdDir, ['.md'])
    await cleanFolder(htmlDir, ['.html'])
    await cleanFolder(cssDir, ['.css'])
    await cleanFolder(jsDir, ['.js'])
}

async function copyMedia(distDir: string): Promise<void> {
    const outputMediaDir = path.join(distDir, 'media')

    await fs.rm(outputMediaDir, {
        recursive: true,
        force: true,
    })

    try {
        await fs.cp(mediaDir, outputMediaDir, {
            recursive: true,
        })

        console.log(
            chalk.green(
                '✅ Copied app/media → ' + path.relative(cwd, outputMediaDir)
            )
        )
    } catch (err) {
        if ((err as NodeError).code !== 'ENOENT') {
            throw err
        }
    }
}

// ============================================================
// Global HTML
// ============================================================

async function loadGlobalHtml(): Promise<void> {
    const indexPath = path.join(mdDir, 'index.md')

    try {
        const content = await fs.readFile(indexPath, 'utf-8')

        // const regex = /\{html\.([a-zA-Z0-9_.-]+)\.global\}/g
        const regex = /\{html\.global\.([a-zA-Z0-9_.-]+)\}/g

        const tokens = [...content.matchAll(regex)]

        let result = ''

        for (const [, name] of tokens) {
            if (!name) continue

            const relativePath = name.replace(/\./g, '/')

            const htmlPath = path.join(htmlDir, `${relativePath}.html`)

            const htmlFolder = path.join(htmlDir, relativePath)

            let htmlContent = ''

            const stat = await fs.stat(htmlFolder).catch(() => null)

            if (stat?.isDirectory()) {
                htmlContent = await readAndConcatFiles(htmlFolder, ['.html'])
            } else {
                htmlContent = await fs.readFile(htmlPath, 'utf-8')
            }

            result += htmlContent + '\n'
        }

        globalHtml = result
    } catch {
        globalHtml = ''
    }
}

// ============================================================
// HTML placeholders
// ============================================================

async function processHtmlPlaceholders(content: string): Promise<string> {
    // content = content.replace(/\{html\.[^}]+\.global\}/g, '')
    content = content.replace(/\{html\.global\.[^}]+\}/g, '')

    const regex = /\{html\.([a-zA-Z0-9_.-]+)\}/g

    let html = content

    const tokens = [...html.matchAll(regex)]

    for (const [token, pathPart] of tokens) {
        if (!pathPart) continue

        const relativePath = pathPart.replace(/\./g, '/')

        const htmlPath = path.join(htmlDir, `${relativePath}.html`)

        const htmlFolder = path.join(htmlDir, relativePath)

        try {
            let htmlContent = ''

            const stat = await fs.stat(htmlFolder).catch(() => null)

            if (stat?.isDirectory()) {
                htmlContent = await readAndConcatFiles(htmlFolder, ['.html'])
            } else {
                htmlContent = await fs.readFile(htmlPath, 'utf-8')
            }

            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

            html = html.replace(
                new RegExp(`<p>\\s*${escaped}\\s*</p>`, 'g'),
                htmlContent
            )

            html = html.replace(new RegExp(escaped, 'g'), htmlContent)
        } catch {
            console.warn(`⚠️ HTML file or folder not found: ${htmlPath}`)
        }
    }

    html = await processCodePlaceholdersHtml(html)

    html = html.replace(/<p>\s*<\/p>/g, '')

    return html
}

// ============================================================
// Code placeholders
// ============================================================

async function processCodePlaceholders(content: string): Promise<string> {
    const regex = /\{code\.([a-zA-Z0-9_.-]+)\}/g

    let result = content

    const tokens = [...content.matchAll(regex)]

    for (const [token, rawPath] of tokens) {
        if (!rawPath) continue

        try {
            const extMatch = rawPath.match(/\.([a-zA-Z0-9]+)$/)

            const ext = extMatch ? extMatch[1] : 'txt'

            const withoutExt = rawPath.replace(/\.[^.]+$/, '')

            const filePath = withoutExt.replace(/\./g, '/')

            const fullPath = path.join(codeDir, `${filePath}.${ext}`)

            const code = await fs.readFile(fullPath, 'utf-8')

            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

            const codeHtml = `
\`\`\`${ext}
${code}
\`\`\`
`

            result = result.replace(new RegExp(escaped, 'g'), codeHtml)
        } catch {
            console.warn(`⚠️ Code file not found: ${rawPath}`)
        }
    }

    return result
}

async function processCodePlaceholdersHtml(content: string): Promise<string> {
    const regex = /\{code\.([a-zA-Z0-9_.-]+)\}/g

    let html = content

    const tokens = [...html.matchAll(regex)]

    for (const [token, rawPath] of tokens) {
        if (!rawPath) continue

        try {
            const extMatch = rawPath.match(/\.([a-zA-Z0-9]+)$/)

            const ext = extMatch ? extMatch[1] : ''

            const withoutExt = rawPath.replace(/\.[^.]+$/, '')

            const filePath = withoutExt.replace(/\./g, '/')

            const fullPath = path.join(codeDir, `${filePath}.${ext}`)

            const code = await fs.readFile(fullPath, 'utf-8')

            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

            const markdownCode = `
\`\`\`${ext}
${code}
\`\`\`
`

            const highlightedHtml = marked(markdownCode)

            html = html.replace(new RegExp(escaped, 'g'), await highlightedHtml)
        } catch {
            console.warn(`⚠️ Code file not found: ${rawPath}`)
        }
    }

    return html
}

// ============================================================
// Project initialization
// ============================================================

async function ensureTemplateExists(): Promise<void> {
    try {
        await fs.access(templatePath)
    } catch {
        await fs.mkdir(publicDir, {
            recursive: true,
        })

        await fs.writeFile(templatePath, staticHtml, 'utf-8')

        console.log(chalk.green('✅ Created default file: public/index.html'))
    }
}

/* async function ensureMdExists(): Promise<void> {
    try {
        await fs.access(mdDir)
    } catch {
        await fs.mkdir(mdDir, {
            recursive: true,
        })

        await fs.writeFile(path.join(mdDir, 'index.md'), defaultMd, 'utf-8')

        console.log(
            chalk.green('✅ Folder app/md dibuat dengan index.md default.')
        )
    }
} */
async function ensureMdExists(): Promise<void> {
    await fs.mkdir(mdDir, {
        recursive: true,
    })

    const files = [
        {
            name: 'index.md',
            content: defaultMd,
        },
        {
            name: '404.md',
            content: '# 404 - Page Not Found',
        },
    ]

    for (const file of files) {
        const filePath = path.join(mdDir, file.name)

        try {
            await fs.access(filePath)
        } catch {
            await fs.writeFile(filePath, file.content, 'utf-8')

            console.log(chalk.green(`✅ Created file: app/md/${file.name}`))
        }
    }
}

async function ensureAppStructure(): Promise<void> {
    const folders = [cssDir, jsDir, htmlDir, codeDir, mediaDir]

    for (const folder of folders) {
        try {
            await fs.access(folder)
        } catch {
            await fs.mkdir(folder, {
                recursive: true,
            })

            console.log(
                chalk.green(
                    `✅ Created directory: ${path.relative(cwd, folder)}`
                )
            )
        }
    }
}

/* async function ensureJsonFileExists(
    filePath: string,
    defaultContent: unknown = []
): Promise<void> {
    try {
        await fs.access(filePath)
    } catch {
        await fs.writeFile(
            filePath,
            JSON.stringify(defaultContent, null, 2),
            'utf-8'
        )

        console.log(chalk.green(`✅ Created file: ${path.basename(filePath)}`))
    }
} */
async function ensureJsonFileExists(
    filePath: string,
    defaultContent: unknown = []
): Promise<void> {
    try {
        await fs.access(filePath)
    } catch {
        await fs.mkdir(path.dirname(filePath), {
            recursive: true,
        })

        await fs.writeFile(
            filePath,
            JSON.stringify(defaultContent, null, 2),
            'utf-8'
        )

        console.log(
            chalk.green(`✅ Created file: ${path.relative(cwd, filePath)}`)
        )
    }
}

async function ensurePrettierIgnore(): Promise<void> {
    try {
        await fs.access(prettierIgnorePath)
    } catch {
        await fs.writeFile(prettierIgnorePath, prettierIgnoreContent, 'utf-8')

        console.log(chalk.green('✅ Created file: .prettierignore'))
    }
}

async function initProject(): Promise<void> {
    const firstRun = await isFirstRun()

    if (!firstRun) {
        console.log(chalk.gray('ℹ️   Project is already initialized.'))

        return
    }

    console.log(chalk.yellow('🚀 Initializing a new project...'))
    await ensureTemplateExists()
    await ensureMdExists()
    await ensureAppStructure()

    await ensureJsonFileExists(configPath, {})
    await ensureJsonFileExists(titlesPath, {})

    await ensureJsonFileExists(cdnCssPath, [])
    await ensureJsonFileExists(cdnJsPath, [])
    await ensureJsonFileExists(cdnHighlightPath, [])

    await ensurePrettierIgnore()

    await loadConfig()

    console.log(chalk.green('✅ Project is ready!'))
}

// ============================================================
// Configuration
// ============================================================

async function loadHighlightCdn(): Promise<string> {
    const defaultUrl =
        'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.2/styles/github.min.css'

    try {
        const data = await fs.readFile(cdnHighlightPath, 'utf-8')

        const parsed: unknown = JSON.parse(data)

        if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            typeof parsed[0] === 'string'
        ) {
            return parsed[0]
        }

        if (typeof parsed === 'string' && parsed.trim() !== '') {
            return parsed
        }

        return defaultUrl
    } catch {
        return defaultUrl
    }
}

async function loadTemplate(): Promise<string> {
    return fs.readFile(templatePath, 'utf-8')
}

async function loadConfig(readonly = false): Promise<UrmineConfig> {
    let config: Partial<UrmineConfig> = {}

    try {
        const data = await fs.readFile(configPath, 'utf-8')

        config = JSON.parse(data) as Partial<UrmineConfig>
    } catch {
        if (readonly) {
            return {} as UrmineConfig
        }

        config = {}
    }

    if (!readonly) {
        let changed = false

        if (!config.outDir) {
            config.outDir = 'dist'
            changed = true
        }

        if (typeof config.singleQuote !== 'boolean') {
            if (config.singleQuote !== undefined) {
                throw new Error('❌ config.singleQuote must be true or false')
            }

            config.singleQuote = true
            changed = true
        }

        if (typeof config.copyButton !== 'boolean') {
            if (config.copyButton !== undefined) {
                throw new Error('❌ config.copyButton must be true or false')
            }

            config.copyButton = false
            changed = true
        }

        if (typeof config.autoTranslate !== 'boolean') {
            if (config.autoTranslate !== undefined) {
                throw new Error('❌ config.autoTranslate must be true or false')
            }

            config.autoTranslate = false
            changed = true
        }

        if (!config.defaultLanguage) {
            config.defaultLanguage = 'en'
            changed = true
        }

        if (typeof config.minify !== 'boolean') {
            if (config.minify !== undefined) {
                throw new Error('❌ config.minify must be true or false')
            }

            config.minify = true
            changed = true
        }

        if (config.base === undefined) {
            config.base = null
            changed = true
        }

        if (changed) {
            await saveConfig(config)
        }
    }

    return config as UrmineConfig
}

async function loadTitles(): Promise<Titles> {
    try {
        const data = await fs.readFile(titlesPath, 'utf-8')

        return JSON.parse(data) as Titles
    } catch {
        await fs.writeFile(titlesPath, JSON.stringify({}, null, 2), 'utf-8')

        console.log(chalk.green('✅ Created file: titles.json'))

        return {}
    }
}

async function saveConfig(config: Partial<UrmineConfig>): Promise<void> {
    const newContent = JSON.stringify(config, null, 2)

    let oldContent = ''

    try {
        oldContent = await fs.readFile(configPath, 'utf-8')
    } catch {}

    if (oldContent === newContent) {
        return
    }

    await fs.writeFile(configPath, newContent, 'utf-8')
}

async function loadCdnLinks(filePath: string): Promise<CdnLinks> {
    try {
        const data = await fs.readFile(filePath, 'utf-8')

        const parsed: unknown = JSON.parse(data)

        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : []
    } catch {
        return []
    }
}

// ============================================================
// Build
// ============================================================

async function build(): Promise<void> {
    try {
        const initialized = await isProjectInitialized()

        await cleanupAll()

        const config = initialized ? await loadConfig() : await loadConfig(true)

        await loadGlobalHtml()

        const basePrefix = config.base ? config.base : ''

        const distDir = path.join(cwd, config.outDir || 'dist')

        await fs.mkdir(distDir, {
            recursive: true,
        })

        //copy dirrektori app/media ke output
        await copyMedia(distDir)

        const cdnCssList = await loadCdnLinks(cdnCssPath)
        const cdnJsList = await loadCdnLinks(cdnJsPath)

        const cdnHighlightUrl = await loadHighlightCdn()

        const cdnCssTags = cdnCssList
            .map(
                (url) =>
                    `<link rel='stylesheet' href='${url}' crossorigin='anonymous' />`
            )
            .join('\n')

        const cdnJsTags = cdnJsList
            .map(
                (url) =>
                    `<script src='${url}' crossorigin='anonymous'></script>`
            )
            .join('\n')

        const template = await loadTemplate()

        const mdFiles = await getMarkdownFilesRecursively(mdDir)

        const titles = await loadTitles()

        for (const inputPath of mdFiles) {
            const relativePath = path.relative(mdDir, inputPath)

            const outputFileName = relativePath.replace(/\.md$/, '.html')

            const outputPath = path.join(distDir, outputFileName)

            await fs.mkdir(path.dirname(outputPath), { recursive: true })

            const mdRaw = await fs.readFile(inputPath, 'utf-8')

            let updatedMdContent = replaceMarkdownLinks(mdRaw)

            updatedMdContent = await processCodePlaceholders(updatedMdContent)

            const htmlFromMarkdown = globalHtml + marked(updatedMdContent)

            const htmlWithInsertedContent =
                await processHtmlPlaceholders(htmlFromMarkdown)

            const htmlWithPrefix = replaceHtmlLinks(
                htmlWithInsertedContent,
                basePrefix
            )

            const hasCodeBlock = /<pre><code/.test(htmlWithInsertedContent)

            const cdnLink = hasCodeBlock
                ? `<link rel='stylesheet' href='${cdnHighlightUrl}' crossorigin='anonymous' />`
                : ''

            const rawCssFiles = await readAndConcatFiles(cssDir, ['.css'])

            const rawCss = [
                rawCssFiles,
                hasCodeBlock && config.copyButton ? staticCss : '',
            ].join('\n')

            const minifiedCss = rawCss
                ? config.minify
                    ? new CleanCSS().minify(rawCss).styles
                    : rawCss
                : ''

            const rawJsFiles = await readAndConcatFiles(jsDir, ['.js'])

            const rawJs = [
                rawJsFiles,
                hasCodeBlock && config.copyButton ? staticJs : '',
                // config.autoTranslate ? translateJs : '',
                config.autoTranslate
                    ? getTranslateJs(config.defaultLanguage)
                    : '',
            ].join('\n')

            const minifiedJs = rawJs
                ? config.minify
                    ? (await minifyJS(rawJs)).code || ''
                    : rawJs
                : ''

            const titleKey = path.basename(inputPath, '.md')

            const title = titles[titleKey] || titleKey

            const styleTag = minifiedCss ? `<style>${minifiedCss}</style>` : ''

            const scriptTag = minifiedJs ? `<script>${minifiedJs}</script>` : ''

            const baseTag = basePrefix ? `<base href="/${basePrefix}/">` : ''

            const fullHtml = template
                .replace(/{title}/g, title)
                .replace(/{base_href}/g, baseTag)
                .replace(/{cdn.highlight}/g, cdnLink)
                .replace(/{cdn.css}/g, cdnCssTags)
                .replace(/{content}/g, htmlWithPrefix)
                .replace(/{style}/g, styleTag)
                .replace(/{script}/g, scriptTag)
                .replace(/{cdn.js}/g, cdnJsTags)

            const commentHeader = `<!--
Developed by: salintatek
-->
`

            const minifiedNormalHtml = config.minify
                ? await minifyHTML(fullHtml, {
                      collapseWhitespace: true,
                      removeComments: true,
                      minifyJS: true,
                      minifyCSS: true,
                  })
                : fullHtml

            const finalOutputHtml = config.singleQuote
                ? minifiedNormalHtml.replace(/="([^"]*)"/g, "='$1'")
                : minifiedNormalHtml

            await fs.writeFile(
                outputPath,
                commentHeader + finalOutputHtml,
                'utf-8'
            )

            console.log(
                chalk.green(
                    `✅ ${relativePath} → ${config.outDir}/${outputFileName}`
                )
            )
        }

        const isRootOutput = path.resolve(distDir) === path.resolve(cwd)

        if (!isRootOutput) {
            const expectedHtmlSet = new Set(
                mdFiles.map((mdPath) => {
                    const rel = path.relative(mdDir, mdPath)

                    return path.join(distDir, rel.replace(/\.md$/, '.html'))
                })
            )

            const existingHtmlFiles = await getHtmlFilesRecursively(distDir)

            for (const htmlFile of existingHtmlFiles) {
                if (!expectedHtmlSet.has(htmlFile)) {
                    await fs.unlink(htmlFile)

                    console.log(
                        chalk.yellow(
                            `🗑️ Removed outdated file: ${path.relative(distDir, htmlFile)}`
                        )
                    )
                }
            }

            await removeEmptyDirs(distDir)
        }

        console.log(chalk.green('🎉 Build completed successfully!'))
    } catch (err) {
        console.error(chalk.red(err))
    }
}

// ============================================================
// Development build
// ============================================================

async function buildDevOnce(): Promise<Map<string, string>> {
    const mdFiles = await getMarkdownFilesRecursively(mdDir)

    if (mdFiles.length === 0) {
        console.log(chalk.yellow('⚠️ No Markdown files found.'))

        return devMemory
    }

    const template = await loadTemplate()
    const titles = await loadTitles()

    const config = await loadConfig()

    await loadGlobalHtml()

    const cdnCssList = await loadCdnLinks(cdnCssPath)
    const cdnJsList = await loadCdnLinks(cdnJsPath)

    const cdnHighlightUrl = await loadHighlightCdn()

    const cdnCssTags = cdnCssList
        .map(
            (url) =>
                `<link rel='stylesheet' href='${url}' crossorigin='anonymous' />`
        )
        .join('\n')

    const cdnJsTags = cdnJsList
        .map((url) => `<script src='${url}' crossorigin='anonymous'></script>`)
        .join('\n')

    for (const inputPath of mdFiles) {
        const relativePath = path.relative(mdDir, inputPath)

        const urlPath =
            '/' + relativePath.replace(/\\/g, '/').replace(/\.md$/, '.html')

        const mdRaw = await fs.readFile(inputPath, 'utf-8')

        let content = replaceMarkdownLinks(mdRaw)

        content = await processCodePlaceholders(content)

        const htmlFromMarkdown = globalHtml + marked(content)

        const htmlWithInjected = await processHtmlPlaceholders(htmlFromMarkdown)

        const hasCodeBlock = /<pre><code/.test(htmlWithInjected)

        const cdnHighlightTag = hasCodeBlock
            ? `<link rel='stylesheet' href='${cdnHighlightUrl}' crossorigin='anonymous' />`
            : ''

        const rawCssFiles = await readAndConcatFiles(cssDir, ['.css'])

        const rawCss = [
            rawCssFiles,
            hasCodeBlock && config.copyButton ? staticCss : '',
        ].join('\n')

        const rawJsFiles = await readAndConcatFiles(jsDir, ['.js'])

        const rawJs = [
            rawJsFiles,
            devReloadScript,
            hasCodeBlock && config.copyButton ? staticJs : '',
            // config.autoTranslate ? translateJs : '',
            config.autoTranslate ? getTranslateJs(config.defaultLanguage) : '',
        ].join('\n')

        const minifiedCss = rawCss
            ? config.minify
                ? new CleanCSS().minify(rawCss).styles
                : rawCss
            : ''

        const minifiedJs = rawJs
            ? config.minify
                ? (await minifyJS(rawJs)).code || ''
                : rawJs
            : ''

        const titleKey = path.basename(inputPath, '.md')

        const title = titles[titleKey] || titleKey

        const styleTag = minifiedCss ? `<style>${minifiedCss}</style>` : ''

        const scriptTag = minifiedJs ? `<script>${minifiedJs}</script>` : ''

        const baseTag = ''

        const fullHtml = template
            .replace(/{title}/g, title)
            .replace(/{base_href}/g, baseTag)
            .replace(/{cdn.highlight}/g, cdnHighlightTag)
            .replace(/{cdn.css}/g, cdnCssTags)
            .replace(/{content}/g, htmlWithInjected)
            .replace(/{style}/g, styleTag)
            .replace(/{script}/g, scriptTag)
            .replace(/{cdn.js}/g, cdnJsTags)

        const finalHtml = config.minify
            ? await minifyHTML(fullHtml, {
                  collapseWhitespace: true,
                  removeComments: true,
                  removeEmptyAttributes: true,
                  minifyCSS: true,
                  minifyJS: true,
              })
            : fullHtml

        const commentHeader = `<!--
GitHub: https://github.com/salintatek
-->
`

        const finalHtmlWithQuotes = config.singleQuote
            ? finalHtml.replace(/="([^"]*)"/g, "='$1'")
            : finalHtml

        devMemory.set(urlPath, commentHeader + finalHtmlWithQuotes)
    }

    if (!devMemory.has('/index.html') && devMemory.size > 0) {
        const first = devMemory.values().next().value

        if (first) {
            devMemory.set('/index.html', first)
        }
    }

    return devMemory
}

// ============================================================
// Development server
// ============================================================

function openBrowser(url: string): void {
    const platform = process.platform

    if (platform === 'win32') {
        exec(`start ${url}`)
    } else if (platform === 'darwin') {
        exec(`open ${url}`)
    } else {
        exec(`xdg-open ${url}`)
    }
}

// Mime media
const mimeTypes: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',

    // Videos
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',

    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',

    // Documents
    '.pdf': 'application/pdf',

    // Fonts
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',

    // Other
    '.json': 'application/json',
    '.txt': 'text/plain',
}

async function dev(): Promise<void> {
    try {
        console.log(chalk.cyan('⚡ Urmine Development Server'))

        await buildDevOnce()

        let clients: ServerResponse[] = []

        /* const server = http.createServer(
            (req: IncomingMessage, res: ServerResponse) => {
                const url = req.url || '/'

                if (url === '/__reload') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    })

                    res.write('\n')

                    clients.push(res)

                    req.on('close', () => {
                        clients = clients.filter((client) => client !== res)
                    })

                    return
                }

                if (url === '/' && devMemory.has('/index.html')) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html',
                    })

                    res.end(devMemory.get('/index.html'))

                    return
                }

                if (devMemory.has(url)) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html',
                    })

                    res.end(devMemory.get(url))

                    return
                }

                res.writeHead(404, {
                    'Content-Type': 'text/plain',
                })

                res.end('404 Not Found')
            }
        ) */
        const server = http.createServer(
            async (req: IncomingMessage, res: ServerResponse) => {
                const url = req.url || '/'

                if (url === '/__reload') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    })

                    res.write('\n')

                    clients.push(res)

                    req.on('close', () => {
                        clients = clients.filter((client) => client !== res)
                    })

                    return
                }

                // Serve media files
                if (url.startsWith('/media/')) {
                    try {
                        const pathname = new URL(url, 'http://localhost')
                            .pathname

                        const relativePath = decodeURIComponent(
                            pathname.slice('/media/'.length)
                        )

                        const mediaPath = path.resolve(mediaDir, relativePath)

                        const relative = path.relative(mediaDir, mediaPath)

                        if (
                            relative.startsWith('..') ||
                            path.isAbsolute(relative)
                        ) {
                            res.writeHead(403)
                            res.end('403 Forbidden')
                            return
                        }

                        const file = await fs.readFile(mediaPath)

                        const ext = path.extname(mediaPath).toLowerCase()

                        res.writeHead(200, {
                            'Content-Type':
                                mimeTypes[ext] || 'application/octet-stream',
                            'Cache-Control': 'no-cache',
                        })

                        res.end(file)
                    } catch {
                        res.writeHead(404)
                        res.end('404 Media Not Found')
                    }

                    return
                }

                if (url === '/' && devMemory.has('/index.html')) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html',
                    })

                    res.end(devMemory.get('/index.html'))

                    return
                }

                if (devMemory.has(url)) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html',
                    })

                    res.end(devMemory.get(url))

                    return
                }

                /* res.writeHead(404, {
                    'Content-Type': 'text/plain',
                })

                res.end('404 Not Found') */
                const notFoundPage = devMemory.get('/404.html')

                res.writeHead(404, {
                    'Content-Type': 'text/html',
                })

                res.end(notFoundPage || '404 Not Found')
            }
        )

        server.listen(3173, '127.0.0.1', () => {
            const url = 'http://127.0.0.1:3173'

            console.log(chalk.green(`🚀 ${url}`))

            openBrowser(url)
        })

        /* chokidar
             .watch([
                mdDir,
                htmlDir,
                cssDir,
                jsDir,
                mediaDir,
                templatePath,
                configPath,
                titlesPath,
                cdnCssPath,
                cdnJsPath,
                cdnHighlightPath,
            ]) */
        chokidar
            .watch([
                mdDir,
                htmlDir,
                cssDir,
                jsDir,
                mediaDir,
                templatePath,
                urmineDir,
            ])
            // .on('all', async (event, file) => {
            .on('change', async (file: string) => {
                console.log(chalk.yellow(`🔄 File changed: ${file}`))

                try {
                    await buildDevOnce()

                    clients.forEach((res) => {
                        res.write('data: reload\n\n')
                    })
                } catch (err) {
                    console.error(chalk.red(err))
                }
            })
    } catch (err) {
        console.error(chalk.red(err))
    }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
    if (isInit) {
        await initProject()
        return
    }

    if (isDev) {
        await dev()
        return
    }

    if (isBuild) {
        await build()
        return
    }

    console.log(chalk.red(`❌ Unknown command: ${mode}`))
}

main().catch((err: unknown) => {
    console.error(chalk.red(err))
    process.exitCode = 1
})
