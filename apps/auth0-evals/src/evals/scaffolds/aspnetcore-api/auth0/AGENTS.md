# Barkbook API (ASP.NET Core) — Agent Guidance

Do not run build, restore, or run commands (do not run `dotnet build`, `dotnet run`, `dotnet restore`, `dotnet test`, or similar). You may edit any project files — `Program.cs`, the classes under `Authorization/`, `BarkbookApi.csproj`, `appsettings.json` — but do not attempt to compile, restore packages, or verify the build.
