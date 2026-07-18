const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("\x1b[31mError: Missing arguments\x1b[0m");
  console.log("Usage: npm run generate:feature <featureName> <ComponentName>");
  console.log("Example: npm run generate:feature animes AnimeList");
  process.exit(1);
}

const featureName = args[0].toLowerCase();
const componentName = args[1];

// Helper to convert PascalCase to kebab-case
const toKebabCase = (str) =>
  str.replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const kebabComponentName = toKebabCase(componentName);

const featureDir = path.join(__dirname, "..", "src", "features", featureName);
const componentDir = path.join(featureDir, "ui", componentName);
// jest only runs suites under `tests/` (see jest.config.js `roots`), so
// generated tests must live in the mirrored tests/ tree, not colocated
// under src/, or they would silently never run.
const testDir = path.join(
  __dirname,
  "..",
  "tests",
  "features",
  featureName,
  "__tests__",
);
const srcComponentImportDir = path
  .join("../../../../src", "features", featureName, "ui", componentName)
  .replaceAll("\\", "/");

// Create directories
[featureDir, path.join(featureDir, "ui"), componentDir, testDir].forEach(
  (dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  },
);

// Templates
const indexTemplate = `export { ${componentName} } from './${componentName}';\n`;

const componentTemplate = `import React from 'react';
import { Card } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import type { ${componentName}Props } from './${kebabComponentName}.types';
import { use${componentName} } from './use-${kebabComponentName}';

export function ${componentName}(props: ${componentName}Props) {
  const { label } = use${componentName}(props);

  return (
    <Card className="p-4">
      <AppText className="text-lg font-bold text-foreground">{label}</AppText>
    </Card>
  );
}
`;

const hookTemplate = `import { useMemo } from 'react';
import type { ${componentName}Props } from './${kebabComponentName}.types';
import { get${componentName}Label } from './${kebabComponentName}.helpers';

export function use${componentName}(props: ${componentName}Props) {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const label = useMemo(() => get${componentName}Label(props.label), [props.label]);

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return {
    label,
  };
}
`;

const typesTemplate = `export interface ${componentName}Props {
  readonly label?: string;
}
`;

const constantsTemplate = `export const ${componentName}DefaultLabel = '${componentName}';
`;

const helpersTemplate = `import { ${componentName}DefaultLabel } from './${kebabComponentName}.constants';

/**
 * Resolves the fallback label shown by the scaffolded component.
 * This keeps even placeholder presentation logic out of the hook body.
 */
export function get${componentName}Label(label?: string) {
  return label ?? ${componentName}DefaultLabel;
}
`;

const schemaTemplate = `import { z } from 'zod';

export const ${componentName}Schema = z.object({
  label: z.string().optional(),
});
`;

const testComponentTemplate = `import React from 'react';
import { render } from '@testing-library/react-native';
import { ${componentName} } from '${srcComponentImportDir}/${componentName}';

describe('${componentName}', () => {
  it('renders correctly', () => {
    const { getByText } = render(<${componentName} label="Test label" />);
    expect(getByText('Test label')).toBeTruthy();
  });

  it('renders fallback label', () => {
    const { getByText } = render(<${componentName} />);
    expect(getByText('${componentName}')).toBeTruthy();
  });
});
`;

const testHookTemplate = `import { renderHook } from '@testing-library/react-native';
import { use${componentName} } from '${srcComponentImportDir}/use-${kebabComponentName}';

describe('use${componentName}', () => {
  it('returns explicit label when provided', () => {
    const { result } = renderHook(() => use${componentName}({ label: 'Test label' }));

    expect(result.current.label).toBe('Test label');
  });

  it('returns fallback label when omitted', () => {
    const { result } = renderHook(() => use${componentName}({}));

    expect(result.current.label).toBe('${componentName}');
  });
});
`;

const testHelperTemplate = `import { get${componentName}Label } from '${srcComponentImportDir}/${kebabComponentName}.helpers';

describe('get${componentName}Label', () => {
  it('returns explicit label', () => {
    expect(get${componentName}Label('Test label')).toBe('Test label');
  });

  it('returns fallback label', () => {
    expect(get${componentName}Label()).toBe('${componentName}');
  });
});
`;

// Write files
const files = {
  "index.ts": indexTemplate,
  [`${componentName}.tsx`]: componentTemplate,
  [`use-${kebabComponentName}.ts`]: hookTemplate,
  [`${kebabComponentName}.types.ts`]: typesTemplate,
  [`${kebabComponentName}.constants.ts`]: constantsTemplate,
  [`${kebabComponentName}.helpers.ts`]: helpersTemplate,
  [`${kebabComponentName}.schema.ts`]: schemaTemplate,
};

const testFiles = {
  [`${componentName}.test.tsx`]: testComponentTemplate,
  [`use-${kebabComponentName}.test.ts`]: testHookTemplate,
  [`${kebabComponentName}.helpers.test.ts`]: testHelperTemplate,
};

// Create main files
Object.entries(files).forEach(([fileName, content]) => {
  const filePath = path.join(componentDir, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(
      `\x1b[32mCreated\x1b[0m: ${path.relative(process.cwd(), filePath)}`,
    );
  } else {
    console.log(`\x1b[33mSkipped\x1b[0m: ${fileName} already exists.`);
  }
});

// Create test files
Object.entries(testFiles).forEach(([fileName, content]) => {
  const filePath = path.join(testDir, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(
      `\x1b[32mCreated\x1b[0m: ${path.relative(process.cwd(), filePath)}`,
    );
  } else {
    console.log(`\x1b[33mSkipped\x1b[0m: ${fileName} already exists.`);
  }
});

console.log(
  "\\n\x1b[32mSuccess: Feature component generated successfully!\x1b[0m",
);
