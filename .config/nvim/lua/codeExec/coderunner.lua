SERVERON = false
local function get_command(filetype, quickRun)
  -- Getting Dir and FileName
  local dir = vim.fn.expand '%:p:h'
  local fileName = vim.fn.expand '%:t'
  -- C/C++
  if filetype == 'cpp' or filetype == 'c' then
    if filetype == 'cpp' then
      RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/cpp.bash -d "'
    else
      RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/c.bash -d "'
    end
    if quickRun then
      RUNWITH = ' '
    else
      RUNWITH = string.lower(vim.fn.input 'Run(r)/Rebuild(b)/DebugCompile(d)/Compile(c)/CompileAndRun(cr): ')
    end
    if RUNWITH == 'r' or RUNWITH == 'cr' then
      local userArgs = vim.fn.input 'If required, enter space separated arguemnts: '
      if userArgs ~= '' then
        return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"' .. '2 ' .. userArgs
      else
        return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"'
      end
    else
      return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"'
    end
    -- SH
  elseif filetype == 'sh' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/sh.bash -d "'
    if quickRun then
      return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. ' ' .. '"'
    else
      local userArgs = vim.fn.input 'If required, enter space separated arguemnts: '
      if userArgs ~= '' then
        return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. 'r' .. '"' .. '2 ' .. userArgs
      else
        return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. 'r' .. '"'
      end
    end
    -- JavaScript
  elseif filetype == 'javascript' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/js.bash -d "'
    if quickRun then
      return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. ' ' .. '"'
    else
      RUNWITH = vim.fn.input 'Vite(v)/Node(n): '
      return RUN .. dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"'
    end
    -- Svelte
  elseif filetype == 'svelte' then
    return 'bash ~/.config/nvim/lua/codeExec/cmds/svelte.bash -d "$dir" -f "$fileName"'
    -- Python
  elseif filetype == 'python' then
    return 'bash ~/.config/nvim/lua/codeExec/cmds/py.bash -d "$dir" -f "$fileName"'
    -- HTML
  elseif filetype == 'html' then
    return 'html'
  elseif filetype == 'markdown' then
    return 'markdown'
  else
    return nil
  end
end

vim.keymap.set('n', '<leader>r', function()
  local filetype = vim.bo.filetype
  local quickRun = false
  local command = get_command(filetype, quickRun)
  if command then
    require('code_runner').setup {
      filetype = {
        [filetype] = command,
      },
    }
    vim.cmd 'w'
    if filetype == 'markdown' then
      vim.cmd 'MarkdownPreview'
    elseif filetype == 'html' then
      -- vim.cmd 'silent! !xdg-open %' -- Running Native Linux
      -- vim.fn.system(
      --   '"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "$(wslpath -w '
      --     .. vim.fn.expand '%:p'
      --     .. ')"'
      -- ) -- WSL
      --
      -- Mac OS
      RUNWITH = string.lower(vim.fn.input 'LiveSerer(l)/StopLiveServer(s)/RestartLiveServer(r)/Browser(b): ')
      if RUNWITH == 'l' then
        vim.cmd 'LiveServerStart'
      elseif RUNWITH == 's' then
        vim.cmd 'LiveServerStop'
      elseif RUNWITH == 'r' then
        vim.cmd 'LiveServerStop'
        vim.cmd 'LiveServerStart'
      else
        vim.cmd 'silent! !open %'
      end
    else
      vim.cmd 'RunCode'
    end
  else
    print('Unsupported filetype ' .. filetype)
  end
end, { noremap = true, silent = false, desc = 'Run Code' })

vim.keymap.set('n', '<leader><CR>', function()
  local filetype = vim.bo.filetype
  local quickRun = true
  local command = get_command(filetype, quickRun)
  if command then
    require('code_runner').setup {
      filetype = {
        [filetype] = command,
      },
    }
    vim.cmd 'w'
    if filetype == 'markdown' then
      vim.cmd 'MarkdownPreview'
    elseif filetype == 'html' then
      -- vim.cmd 'silent! !xdg-open %' -- Running Native Linux
      -- vim.fn.system(
      --   '"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "$(wslpath -w '
      --     .. vim.fn.expand '%:p'
      --     .. ')"'
      -- ) -- WSL
      vim.cmd 'LiveServerStart' -- Live Server Mac OS
    else
      vim.cmd 'RunCode'
    end
  else
    print 'Unsupported filetype'
  end
end, { noremap = true, silent = false, desc = 'Quick Run Code' })
