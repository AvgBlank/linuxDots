-- Telescope
require('telescope').setup {
  defaults = {
    file_ignore_patterns = {
      'node_modules',
    },
  },
}
require('telescope').load_extension 'fzf'

-- Color Scheme
vim.cmd.colorscheme 'catppuccin-mocha'
vim.api.nvim_set_hl(0, 'Normal', { bg = 'none' })
vim.api.nvim_set_hl(0, 'NormalFloat', { bg = 'none' })

-- Treesitter
local Rule = require 'nvim-autopairs.rule'
require('nvim-treesitter.configs').setup {
  -- A list of parser names, or "all" (the listed parsers MUST always be installed)
  ensure_installed = { 'c', 'lua', 'vim', 'markdown', 'cpp', 'javascript', 'typescript', 'python' },

  -- Install parsers synchronously (only applied to `ensure_installed`)
  sync_install = false,

  -- Automatically install missing parsers when entering buffer
  -- Recommendation: set to false if you don't have `tree-sitter` CLI installed locally
  auto_install = true,

  highlight = {
    enable = true,

    additional_vim_regex_highlighting = false,
  },
}

-- Auto Close Bracket
require('nvim-autopairs').setup {
  enable_check_bracket_line = false,
  ignored_next_char = '[%w%.]',
}

local npairs = require 'nvim-autopairs'

npairs.setup {
  fast_wrap = {},
}
npairs.setup {
  check_ts = true,
  ts_config = {
    lua = { 'string' }, -- it will not add a pair on that treesitter node
    javascript = { 'template_string' },
  },
}
local ts_conds = require 'nvim-autopairs.ts-conds'
-- press % => %% only while inside a comment or string
npairs.add_rules {
  Rule('%', '%', 'lua'):with_pair(ts_conds.is_ts_node { 'string', 'comment' }),
  Rule('$', '$', 'lua'):with_pair(ts_conds.is_not_ts_node { 'function' }),
}

-- LSP
local lsp = require 'lsp-zero'
lsp.preset 'recommended'
local cmp = require 'cmp'
require('nvim-highlight-colors').setup {}
local cmp_autopairs = require 'nvim-autopairs.completion.cmp'
local cmp_select = { behavior = cmp.SelectBehavior.Select }
cmp.event:on('confirm_done', cmp_autopairs.on_confirm_done())
lsp.defaults.cmp_mappings {
  ['<C-p>'] = cmp.mapping.select_prev_item(cmp_select),
  ['<C-n>'] = cmp.mapping.select_next_item(cmp_select),
  ['<C-y>'] = cmp.mapping.confirm { select = true },
  ['<C-Space>'] = cmp.mapping.complete(),
}
require('cmp').setup {
  formatting = {
    format = require('nvim-highlight-colors').format,
  },
}
require('mason').setup {}
local lsp_config = require 'lspconfig'
require('mason-lspconfig').setup {
  ensure_installed = {
    'pyright',
    'clangd',
    'lua_ls',
    'eslint',
    'ts_ls',
    'bashls',
    'cssls',
    'emmet_language_server',
  },
  handlers = {
    function(server_name)
      require('lspconfig')[server_name].setup {}
    end,
  },
}
lsp_config.lua_ls.setup {
  settings = {
    Lua = {
      diagnostics = {
        globals = { 'vim' },
      },
    },
  },
}
lsp.setup()

-- Autoclose html Tags
require('nvim-ts-autotag').setup()

-- Lua line
require('lualine').setup {
  options = { theme = 'catppuccin-mocha' },
}

-- Highlight Indents
local highlight = {
  'RainbowRed',
  'RainbowYellow',
  'RainbowBlue',
  'RainbowOrange',
  'RainbowGreen',
  'RainbowViolet',
  'RainbowCyan',
}
local hooks = require 'ibl.hooks'
hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
  vim.api.nvim_set_hl(0, 'RainbowRed', { fg = '#E06C75' })
  vim.api.nvim_set_hl(0, 'RainbowYellow', { fg = '#E5C07B' })
  vim.api.nvim_set_hl(0, 'RainbowBlue', { fg = '#61AFEF' })
  vim.api.nvim_set_hl(0, 'RainbowOrange', { fg = '#D19A66' })
  vim.api.nvim_set_hl(0, 'RainbowGreen', { fg = '#98C379' })
  vim.api.nvim_set_hl(0, 'RainbowViolet', { fg = '#C678DD' })
  vim.api.nvim_set_hl(0, 'RainbowCyan', { fg = '#56B6C2' })
end)
vim.g.rainbow_delimiters = { highlight = highlight }
require('ibl').setup { scope = { highlight = highlight } }
hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)

-- Oil.nvim
require('oil').setup {
  default_file_explorer = true,
  columns = { 'icon' },
  skip_confirm_for_simple_edits = true,
  keymaps = {
    ['<C-h>'] = false,
    ['<C-j>'] = false,
    ['<C-k>'] = false,
    ['<C-l>'] = false,
  },
  view_options = {
    show_hidden = true,
  },
}

-- Conform (Formatter)
require('conform').setup {
  notify_on_error = false,

  -- Auto Format --
  -- format_on_save = {
  --   timeout_ms = 2000,
  --   lsp_fallback = true,
  -- },

  formatters_by_ft = {
    lua = { 'stylua' },
    python = { 'black' },
    javascript = { 'prettier', 'prettierd', stop_after_first = true },
    markdown = { 'prettier', 'prettierd', stop_after_first = true },
    bash = { 'beautysh' },
    sh = { 'beautysh' },
    json = { 'prettier', 'prettierd', stop_after_first = true },
    html = { 'prettier', 'prettierd', stop_after_first = true },
    css = { 'prettier', 'prettierd', stop_after_first = true },
    c = { 'clang-format' },
    cpp = { 'clang-format' },
  },
}
