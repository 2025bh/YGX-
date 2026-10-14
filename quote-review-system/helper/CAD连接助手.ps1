param([switch]$Once)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot '连接配置.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$quoteHeaders = @{ Authorization = 'Bearer ' + $cfg.token }
$quoteCache = Join-Path $PSScriptRoot '只读图纸缓存'
New-Item -ItemType Directory -Path $quoteCache -Force | Out-Null
if ($cfg.server -notmatch '^https://|^http://(localhost|127\.0\.0\.1)(:\d+)?$') { throw '其他电脑必须使用受信任的HTTPS主机地址；不能跳过证书校验。' }
Write-Host 'CAD连接助手已启动。回到审核台点击“本机CAD”。按 Ctrl+C 停止。'
do {
  try {
    $job = Invoke-RestMethod -Uri ($cfg.server + '/api/cad/poll') -Headers $quoteHeaders -TimeoutSec 12
    if ($job.job) {
      try {
        $p = $job.payload
        if ($p.action -notin @('open','capture') -or $p.source_sha -notmatch '^[a-f0-9]{64}$' -or $p.source_asset -notmatch '^[a-f0-9]{32}$' -or $p.bounds.Count -ne 4) { throw 'CAD任务内容校验失败' }
        $quotePath = Join-Path $quoteCache ($p.source_sha + '.dwg')
        if (-not (Test-Path -LiteralPath $quotePath)) { Invoke-WebRequest -Uri ($cfg.server + '/api/cad/source/' + $p.source_asset) -Headers $quoteHeaders -OutFile $quotePath -TimeoutSec 60 }
        if ((Get-FileHash -LiteralPath $quotePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.source_sha) { throw '图纸版本不一致，停止定位；请保留缓存并联系管理员核查' }
        $acad = $null
        foreach ($prog in @('AutoCAD.Application.24.0','AutoCAD.Application.24','AutoCAD.Application')) {
          try { $acad = [Runtime.InteropServices.Marshal]::GetActiveObject($prog); break } catch { }
        }
        if (-not $acad -and $p.action -eq 'open') { $acad = New-Object -ComObject AutoCAD.Application.24.0 }
        if (-not $acad) { throw '没有运行中的CAD，请先点击本机CAD定位' }
        if (-not $acad.Version.StartsWith('24.0')) { throw '第一版连接助手适配AutoCAD2021，当前版本不匹配' }
        if ($p.action -eq 'open') {
          $acad.Visible = $true
          $doc = $null
          foreach ($candidate in $acad.Documents) { if ($candidate.FullName -eq $quotePath) { $doc = $candidate; break } }
          if (-not $doc) { $doc = $acad.Documents.Open($quotePath, $true) }
          $doc.Activate()
          [double[]]$quoteMin = @([double]$p.bounds[0],[double]$p.bounds[1],0.0)
          [double[]]$quoteMax = @([double]$p.bounds[2],[double]$p.bounds[3],0.0)
          $acad.ZoomWindow($quoteMin,$quoteMax)
          $result = @{status='done';message=('已定位到图' + $p.figure + '，未改源DWG。请在CAD中核实部件。')}
          Invoke-RestMethod -Method Post -Uri ($cfg.server + '/api/cad/jobs/' + $job.job + '/result') -Headers $quoteHeaders -Body $result -TimeoutSec 15 | Out-Null
        } else {
          $doc = $acad.ActiveDocument
          if ($doc.FullName -ne $quotePath) { throw '当前打开的图纸不是此项目的同版只读副本，请先重新定位' }
          if ([int]$doc.GetVariable('DBMOD') -ne 0) { throw '当前CAD副本有未保存修改，请重新打开同版只读副本后取图' }
          if ([int]$doc.GetVariable('TILEMODE') -ne 1) { throw '请切换模型空间后取图，避免布局视口位置不匹配' }
          $vp = $doc.ActiveViewport
          if ([Math]::Abs($vp.TwistAngle) -gt 0.0001 -or [Math]::Abs($vp.Direction[2]-1) -gt 0.0001) { throw '请切换无旋转的平面视图后取图' }
          $center = $doc.GetVariable('VIEWCTR');$height = [double]$doc.GetVariable('VIEWSIZE');$screen = $doc.GetVariable('SCREENSIZE')
          if ($center[0] -lt $p.bounds[0] -or $center[0] -gt $p.bounds[2] -or $center[1] -lt $p.bounds[1] -or $center[1] -gt $p.bounds[3]) { throw '当前CAD画面不在此项图框内，请先定位再取图' }
          $width = $height * [double]$screen[0] / [double]$screen[1]
          [double[]]$lower = @($center[0]-$width/2,$center[1]-$height/2)
          [double[]]$upper = @($center[0]+$width/2,$center[1]+$height/2)
          $layout=$doc.ActiveLayout;$restore=$doc.PlotConfigurations.Add('QuoteRestore' + [Guid]::NewGuid().ToString('N'),$true);$restore.CopyFrom($layout)
          $background=$doc.GetVariable('BACKGROUNDPLOT');$png=Join-Path $quoteCache ($job.job + '.png')
          try {
            $doc.SetVariable('BACKGROUNDPLOT',0)
            $layout.ConfigName='PublishToWeb PNG.pc3';$layout.RefreshPlotDeviceInfo();$layout.PlotType=4;$layout.SetWindowToPlot($lower,$upper);$layout.UseStandardScale=$true;$layout.StandardScale=0;$layout.CenterPlot=$true;$layout.PlotRotation=1
            if (-not $doc.Plot.PlotToFile($png)) { throw 'CAD出图失败，请检查打印配置' }
          } finally { $layout.CopyFrom($restore);$restore.Delete();$doc.SetVariable('BACKGROUNDPLOT',$background) }
          # HttpClient multipart works in Windows PowerShell 5.1 without uploading the desktop.
          Add-Type -AssemblyName System.Net.Http
          $http=New-Object System.Net.Http.HttpClient;$http.DefaultRequestHeaders.Authorization=New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer',$cfg.token)
          $form=New-Object System.Net.Http.MultipartFormDataContent
          $form.Add((New-Object System.Net.Http.StringContent('done')),'status')
          $form.Add((New-Object System.Net.Http.StringContent('同版CAD当前视图已带回，请预览并确认证据')),'message')
          $image=New-Object System.Net.Http.ByteArrayContent -ArgumentList (,[IO.File]::ReadAllBytes($png));$image.Headers.ContentType=New-Object System.Net.Http.Headers.MediaTypeHeaderValue('image/png')
          $form.Add($image,'file','cad-view.png')
          $response=$http.PostAsync(($cfg.server + '/api/cad/jobs/' + $job.job + '/result'),$form).GetAwaiter().GetResult();$response.EnsureSuccessStatusCode() | Out-Null
          $http.Dispose();$form.Dispose()
        }
      } catch {
        $message=$_.Exception.Message
        Write-Host ('CAD任务失败：' + $message)
        Invoke-RestMethod -Method Post -Uri ($cfg.server + '/api/cad/jobs/' + $job.job + '/result') -Headers $quoteHeaders -Body @{status='failed';message=$message} -TimeoutSec 15 | Out-Null
      }
    }
  } catch { Write-Host ('连接暂时失败：' + $_.Exception.Message) }
  if (-not $Once) { Start-Sleep -Seconds 3 }
} while (-not $Once)
