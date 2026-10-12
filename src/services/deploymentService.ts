import crypto from 'crypto';
import { getPool } from '../db/connection';
import { CodePackage } from '../types';

export class DeploymentService {
  private inMemoryPackages: CodePackage[] = [
    {
      id: 'pkg-01',
      package_name: 'oxide-2026-09-17T15-48-05',
      file_size_mb: 0.18,
      sha256: '9b82c1e7a5c8df71a3e89647b2c019d65f8a02d4e6f9c8b7a1d5e3f4a2b6c8d0',
      source_path: '/www/project_oxide/oxide_project_git',
      components: ['src/', 'scripts/', 'package.json'],
      created_at: new Date('2026-09-17T15:48:05Z'),
    },
  ];

  public async getPackages(): Promise<CodePackage[]> {
    try {
      const pool = getPool();
      const res = await pool.query(`SELECT * FROM code_packages ORDER BY created_at DESC;`);
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: r.id,
          package_name: r.package_name,
          file_size_mb: parseFloat(r.file_size_mb),
          sha256: r.sha256,
          source_path: r.source_path,
          components: typeof r.components === 'string' ? JSON.parse(r.components) : r.components,
          created_at: new Date(r.created_at),
        }));
      }
    } catch {
      // Fallback to in-memory
    }
    return this.inMemoryPackages;
  }

  public async getLatestPackage(): Promise<CodePackage> {
    const pkgs = await this.getPackages();
    return pkgs[0];
  }

  public async createPackage(params?: {
    customName?: string;
    sourcePath?: string;
    components?: string[];
  }): Promise<CodePackage> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const packageName = params?.customName || `oxide-${timestamp}`;
    const sourcePath = params?.sourcePath || '/www/project_oxide/oxide_project_git';
    const components = params?.components || ['src/', 'scripts/', 'package.json'];
    const dummyContent = `${packageName}-${Date.now()}`;
    const sha256 = crypto.createHash('sha256').update(dummyContent).digest('hex');
    const fileSizeMb = 0.18;

    const newPkg: CodePackage = {
      id: `pkg-${Date.now()}`,
      package_name: packageName,
      file_size_mb: fileSizeMb,
      sha256,
      source_path: sourcePath,
      components,
      created_at: new Date(),
    };

    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO code_packages (id, package_name, file_size_mb, sha256, source_path, components, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW());`,
        [newPkg.id, newPkg.package_name, newPkg.file_size_mb, newPkg.sha256, newPkg.source_path, JSON.stringify(newPkg.components)]
      );

      await pool.query(
        `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
         VALUES ('admin', 'CODE_PACKAGED', 'PACKAGE', $1, $2, NOW());`,
        [newPkg.id, JSON.stringify(newPkg)]
      );
    } catch (err: any) {
      console.warn('[Deployment DB Warning]:', err.message);
    }

    this.inMemoryPackages.unshift(newPkg);
    return newPkg;
  }
}

export const deploymentService = new DeploymentService();
