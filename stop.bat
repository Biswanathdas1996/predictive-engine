@echo off
setlocal
cd /d "%~dp0"
set "PE_ROOT=%CD%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = $env:PE_ROOT; " ^
  "$procs = Get-CimInstance Win32_Process | Where-Object { " ^
  "  $_.Name -eq 'node.exe' -and $_.CommandLine -and " ^
  "  $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and " ^
  "  $_.CommandLine -like '*vite*' -and $_.CommandLine -like '*prediction-engine*' " ^
  "}; " ^
  "if (-not $procs) { Write-Host 'No matching dev server found.'; exit 0 }; " ^
  "$procs | ForEach-Object { Write-Host ('Stopping PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

endlocal
