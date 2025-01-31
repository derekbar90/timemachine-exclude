import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as readline from 'readline';
import { Command } from 'commander';

interface Config {
    parentDirs: string[];
    excludePatterns: string[];
}

class TMExclude {
    private exclusionFile: string;
    private configFile: string;
    private defaultParentDirs: string[];
    private defaultExcludePatterns: string[];
    private program: Command;

    constructor() {
        this.exclusionFile = path.join(os.homedir(), '.tm_exclusions_tm_exclude');
        this.configFile = path.join(os.homedir(), '.tm_exclude_config');
        this.defaultParentDirs = [
            path.join(os.homedir(), 'Projects'),
            path.join(os.homedir(), 'Workspace'),
            path.join(os.homedir(), 'Development')
        ];
        this.defaultExcludePatterns = ['node_modules', 'dist', 'build'];
        this.program = new Command();
        this.setupCommands();
    }

    private setupCommands(): void {
        this.program
            .name('timemachine-exclude')
            .description('A CLI tool to manage Time Machine exclusions for node_modules')
            .version('1.0.0');

        this.program
            .command('init')
            .description('Initialize timemachine-exclude with parent directories')
            .action(() => this.initConfig());

        this.program
            .command('populate')
            .description('Find node_modules directories and update exclusions')
            .action(() => this.populateExclusions());

        this.program
            .command('apply')
            .description('Apply the exclusions to Time Machine')
            .action(() => this.applyExclusions());

        this.program
            .command('update')
            .description('Populate and apply exclusions')
            .action(() => this.updateExclusions());

        this.program
            .command('list')
            .description('List current Time Machine exclusions')
            .action(() => this.listExclusions());
    }

    private showHelp(): void {
        console.log(`
Usage: timemachine-exclude [command] [options]

Commands:
  init        Initialize timemachine-exclude with parent directories.
  populate    Find node_modules directories and update exclusions.
  apply       Apply the exclusions to Time Machine.
  update      Populate and apply exclusions.
  list        List current Time Machine exclusions.
  help        Display this help message.

Examples:
  timemachine-exclude init
  timemachine-exclude populate
  timemachine-exclude apply
  timemachine-exclude update
  timemachine-exclude list

For more information on a specific command, use:
  timemachine-exclude [command] --help
        `);
    }

    private async promptUser(question: string): Promise<string> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }

    private async initConfig(): Promise<void> {
        if (fs.existsSync(this.configFile)) {
            const answer = await this.promptUser('Configuration already exists. Overwrite? (y/N): ');
            if (!answer.toLowerCase().startsWith('y')) {
                console.log('Initialization canceled.');
                return;
            }
        }

        console.log('Initializing timemachine-exclude...');
        console.log('Enter parent directories to search in.');
        console.log('Enter each directory path followed by [ENTER]. When done, enter an empty line.');

        const parentDirs: string[] = [];
        while (true) {
            const dir = await this.promptUser('Directory: ');
            if (!dir) break;

            const expandedDir = dir.replace(/^~/, os.homedir());
            if (fs.existsSync(expandedDir)) {
                parentDirs.push(expandedDir);
            } else {
                console.log(`Directory does not exist: ${expandedDir}. Skipping.`);
            }
        }

        console.log('\nEnter directory names or patterns to exclude.');
        console.log('Enter each pattern followed by [ENTER]. When done, enter an empty line.');
        console.log('Example patterns: node_modules, dist, build, *.cache');

        const excludePatterns: string[] = [];
        while (true) {
            const pattern = await this.promptUser('Pattern: ');
            if (!pattern) break;
            excludePatterns.push(pattern);
        }

        const config: Config = {
            parentDirs: parentDirs.length ? parentDirs : this.defaultParentDirs,
            excludePatterns: excludePatterns.length ? excludePatterns : this.defaultExcludePatterns
        };

        fs.writeFileSync(
            this.configFile,
            JSON.stringify(config, null, 2)
        );

        console.log(`Configuration saved to ${this.configFile}`);
    }

    private loadConfig(): Config {
        if (!fs.existsSync(this.configFile)) {
            throw new Error("Configuration file not found. Please run 'timemachine-exclude init' first.");
        }
        return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
    }

    private findExcludedDirs(dir: string, patterns: string[]): string[] {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (patterns.some(pattern => {
                    if (pattern.includes('*')) {
                        return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(entry.name);
                    }
                    return entry.name === pattern;
                })) {
                    results.push(fullPath);
                } else {
                    try {
                        results.push(...this.findExcludedDirs(fullPath, patterns));
                    } catch (error: any) {
                        console.log(`Error accessing ${fullPath}: ${error.message}`);
                    }
                }
            }
        }
        return results;
    }

    private async populateExclusions(): Promise<void> {
        const config = this.loadConfig();
        console.log('Populating exclusions...');

        const header = `# Time Machine Exclusions - Generated by timemachine-exclude on ${new Date().toISOString()}\n\n`;
        fs.writeFileSync(this.exclusionFile, header);

        for (const dir of config.parentDirs) {
            if (fs.existsSync(dir)) {
                console.log(`Searching in: ${dir}`);
                const excludedDirs = this.findExcludedDirs(dir, config.excludePatterns);
                excludedDirs.forEach(excludedDir => {
                    fs.appendFileSync(this.exclusionFile, excludedDir + '\n');
                    console.log(`Excluded: ${excludedDir}`);
                });
            } else {
                console.log(`Directory not found: ${dir}. Skipping.`);
            }
        }

        console.log(`\nAll excluded directories have been listed in ${this.exclusionFile}`);
    }

    private async applyExclusions(): Promise<void> {
        if (!fs.existsSync(this.exclusionFile)) {
            throw new Error(`Exclusion file ${this.exclusionFile} not found. Please run 'timemachine-exclude populate' first.`);
        }

        console.log('Applying exclusions to Time Machine...');

        const lines = fs.readFileSync(this.exclusionFile, 'utf-8').split('\n');
        for (const line of lines) {
            if (!line || line.startsWith('#')) continue;

            if (fs.existsSync(line)) {
                execSync(`tmutil addexclusion "${line}"`);
                console.log(`Added exclusion: ${line}`);
            } else {
                console.log(`Path does not exist: ${line}. Skipping.`);
            }
        }

        console.log('All exclusions have been applied to Time Machine.');
    }

    private async updateExclusions(): Promise<void> {
        await this.populateExclusions();
        await this.applyExclusions();
    }

    private listExclusions(): void {
        console.log('Listing current Time Machine exclusions for node_modules:');
        if (!fs.existsSync(this.exclusionFile)) {
            throw new Error("No exclusion file found. Please run 'timemachine-exclude populate' first.");
        }

        const lines = fs.readFileSync(this.exclusionFile, 'utf-8').split('\n');
        for (const line of lines) {
            if (!line || line.startsWith('#')) continue;
            console.log(line);
        }
    }

    public async run(args: string[]): Promise<void> {
        try {
            await this.program.parseAsync(args);
        } catch (error: any) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    }
}

// Create CLI entry point
if (require.main === module) {
    const tmExclude = new TMExclude();
    tmExclude.run(process.argv);
}

export default TMExclude; 