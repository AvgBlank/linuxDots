local function get_command(filetype, quickRun)
  -- Getting Dir and FileName
  local dir = vim.fn.expand '%:p:h'
  local fileName = vim.fn.expand '%:t'
  vim.cmd 'w'
  -- C/C++
  if filetype == 'cpp' or filetype == 'c' or filetype == 'rust' then
    if filetype == 'cpp' then
      RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/cpp.bash -d "'
    elseif filetype == 'c' then
      RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/c.bash -d "'
    else
      RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/rust.bash -d "'
    end
    if quickRun then
      RUNWITH = ' '
    else
      RUNWITH = string.lower(vim.fn.input 'Run(r)/Rebuild(b)/DebugCompile(d)/Compile(c)/CompileAndRun(cr): ')
    end
    if RUNWITH == 'r' or RUNWITH == 'cr' then
      local userArgs = vim.fn.input 'If required, enter space separated arguemnts: '
      if userArgs ~= '' then
        vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
          dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"' .. '2 ' .. userArgs)
      else
        vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
          dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"')
      end
    else
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"')
    end
    return true
    -- SH
  elseif filetype == 'sh' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/sh.bash -d "'
    if quickRun then
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. ' ' .. '"')
    else
      local userArgs = vim.fn.input 'If required, enter space separated arguemnts: '
      if userArgs ~= '' then
        vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
          dir .. '" -f "' .. fileName .. '" -r "' .. 'r' .. '"' .. '2 ' .. userArgs)
      else
        vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
          dir .. '" -f "' .. fileName .. '" -r "' .. 'r' .. '"')
      end
    end
    return true
    -- Svelte
  elseif filetype == 'svelte' then
    vim.cmd('botright 12split | set nonu nornu | terminal bash ~/.config/nvim/lua/codeExec/cmds/svelte.bash -d "' ..
      dir .. '" -f "' .. fileName .. '"')
    return true
    -- JavaScript
  elseif filetype == 'javascript' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/js.bash -d "'
    if quickRun then
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. ' ' .. '"')
    else
      RUNWITH = vim.fn.input 'npm run dev(v)/Node(n): '
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"')
    end
    return true
    -- JavaScript React
  elseif filetype == 'javascriptreact' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/js.bash -d "'
    vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
      dir .. '" -f "' .. fileName .. '" -r "' .. "v" .. '"')
    return true
    -- Typescript
  elseif filetype == 'typescript' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/ts.bash -d "'
    if quickRun then
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. ' ' .. '"')
    else
      RUNWITH = vim.fn.input 'npm run dev(v)/Tsc(t)/TscCurrentFile(c): '
      vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
        dir .. '" -f "' .. fileName .. '" -r "' .. RUNWITH .. '"')
    end
    return true
    -- JavaScript React
  elseif filetype == 'typescriptreact' then
    RUN = 'bash ~/.config/nvim/lua/codeExec/cmds/ts.bash -d "'
    vim.cmd('botright 12split | set nonu nornu | terminal ' .. RUN ..
      dir .. '" -f "' .. fileName .. '" -r "' .. "v" .. '"')
    return true
    -- Python
  elseif filetype == 'python' then
    vim.cmd('botright 12split | set nonu nornu | terminal bash ~/.config/nvim/lua/codeExec/cmds/py.bash -d "' ..
      dir .. '" -f "' .. fileName .. '"')
    return true
    -- HTML
  elseif filetype == 'html' then
    if quickRun then
      -- vim.cmd 'silent! !xdg-open %' -- Running Native Linux
      -- vim.fn.system(
      --   '"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "$(wslpath -w '
      --     .. vim.fn.expand '%:p'
      --     .. ')"'
      -- ) -- WSL
      vim.cmd 'LiveServerStart' -- Live Server Mac OS
    else
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
    end
    return true
    -- MarkDown
  elseif filetype == 'markdown' then
    vim.cmd 'MarkdownPreview'
    return true
  else
    return nil
  end
end

vim.keymap.set('n', '<leader>r', function()
  local filetype = vim.bo.filetype
  local quickRun = false
  local command = get_command(filetype, quickRun)
  if not command then
    print('Unsupported filetype ' .. filetype)
  end
end, { noremap = true, silent = false, desc = 'Run Code' })

vim.keymap.set('n', '<leader><CR>', function()
  local filetype = vim.bo.filetype
  local quickRun = true
  local command = get_command(filetype, quickRun)
  if not command then
    print('Unsupported filetype ' .. filetype)
  end
end, { noremap = true, silent = false, desc = 'Quick Run Code' })
