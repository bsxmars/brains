import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_SCRIPT_CODE, DEPENDENCY_RESTART_CODE } from '@/content/delivery/compose/data';
import { INSTRUCTION_LAYERS_CODE } from '@/content/delivery/docker/data';

/** Реальный BuildKit, без сети, запуска контейнеров и скачивания базовых образов. */
function available(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

describe.skipIf(!available())('инструкция Dockerfile и файловый слой — разные вещи', () => {
  it('ENV/LABEL/CMD не создают RootFS-слои, WORKDIR может создать каталог, COPY добавляет файл', () => {
    const root = mkdtempSync(join(tmpdir(), 'lesson-image-mechanism-'));
    const images: string[] = [];
    try {
      writeFileSync(join(root, 'Dockerfile'), INSTRUCTION_LAYERS_CODE);
      writeFileSync(join(root, 'payload.txt'), 'lesson layer\n');
      const inspect = (target: string) => {
        const name = `lesson-image-mechanism-${process.pid}:${target}`;
        images.push(name);
        execFileSync('docker', ['build', '--pull=false', '--target', target, '-t', name, root], {
          encoding: 'utf8', timeout: 30_000, stdio: 'pipe',
        });
        return JSON.parse(execFileSync('docker', ['image', 'inspect', name], { encoding: 'utf8', timeout: 5000 }))[0] as {
          RootFS: { Layers?: string[] }; Config: { Env: string[]; Cmd: string[]; WorkingDir: string };
        };
      };
      const metadata = inspect('metadata');
      const directory = inspect('directory');
      const payload = inspect('payload');
      expect(metadata.RootFS.Layers ?? []).toHaveLength(0);
      expect(metadata.Config.Env).toContain('MODE=production');
      expect(metadata.Config.Cmd).toEqual(['app']);
      expect(directory.Config.WorkingDir).toBe('/app');
      expect(directory.RootFS.Layers).toHaveLength(1);
      expect(payload.RootFS.Layers).toHaveLength(2);
    } finally {
      for (const name of images.reverse()) {
        try { execFileSync('docker', ['image', 'rm', name], { timeout: 5000, stdio: 'pipe' }); } catch { /* незавершённая сборка могла не создать тег */ }
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});


describe.skipIf(!available())('Compose: конфигурация двух restart-политик', () => {
  it('реальный compose config различает политику контейнера и операцию над зависимостью', () => {
    const config = JSON.parse(execFileSync('docker', ['compose', '-f', '-', 'config', '--format', 'json', '--no-interpolate'], {
      input: DEPENDENCY_RESTART_CODE, encoding: 'utf8', timeout: 5000, stdio: 'pipe',
    }));
    expect(config.services.db.restart).toBe('on-failure:3');
    expect(config.services.app.depends_on.db).toMatchObject({ condition: 'service_healthy', restart: true });
    expect(config.services.app.restart).toBeUndefined();
  });
});


it('показанный app.sh синтаксически исполняем оболочкой из entrypoint', () => {
  expect(() => execFileSync('/bin/sh', ['-n'], { input: APP_SCRIPT_CODE, encoding: 'utf8', timeout: 3000 })).not.toThrow();
  expect(APP_SCRIPT_CODE).toContain("exec psql -h db -U app -d appdb");
});
