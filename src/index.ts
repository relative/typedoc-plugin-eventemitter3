import {
  Application,
  Context,
  Converter,
  DeclarationReflection,
  Reflection,
  ReflectionKind,
  ReflectionType,
  TypeScript as ts,
} from 'typedoc'

function getInheritanceChain(
  checker: ts.TypeChecker,
  decl: ts.ClassDeclaration,
  _chain?: [string, string][]
): [string, string][] {
  _chain = _chain || []

  if (!decl.heritageClauses) {
    return _chain // No more inheritance
  } else {
    for (const clause of decl.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
      const extendsType = clause.types[0]
      if (!extendsType) continue
      const sym = checker.getTypeFromTypeNode(extendsType).getSymbol()
      if (!sym || !sym.declarations) continue
      for (const d of sym.declarations) {
        if (!ts.isClassDeclaration(d)) continue
        _chain = [
          ..._chain,
          [sym.name, d.getSourceFile().fileName],
          ...getInheritanceChain(checker, d, _chain),
        ]
      }
    }
  }

  return _chain
}

function inheritsEventEmitter3(
  checker: ts.TypeChecker,
  node: ts.ClassDeclaration
): boolean {
  return (
    getInheritanceChain(checker, node).findIndex(([_name, file]) =>
      file.includes('eventemitter3')
    ) !== -1
  )
}

export function load(app: Application) {
  const _events: [number, DeclarationReflection][] = []

  app.converter.on(
    Converter.EVENT_CREATE_DECLARATION,
    (context: Context, _reflection: Reflection, node: ts.Node) => {
      if (!node) return
      if (
        _reflection.kind === ReflectionKind.Class &&
        ts.isClassDeclaration(node)
      ) {
        if (!node.heritageClauses) return
        for (const clause of node.heritageClauses) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
          if (!inheritsEventEmitter3(context.checker, node)) continue
          const extendsType = clause.types[0]
          if (
            !extendsType.typeArguments ||
            extendsType.typeArguments.length === 0
          )
            continue

          const eventTypeNode = extendsType.typeArguments[0],
            etnType = context.checker.getTypeFromTypeNode(eventTypeNode)
          for (const prop of etnType.getProperties()) {
            if (!prop.declarations || prop.declarations.length === 0) continue
            const propertyDeclaration = prop
              .declarations?.[0] as ts.PropertyDeclaration
            if (!propertyDeclaration) continue
            let fnTypeNode: ts.FunctionTypeNode | undefined
            propertyDeclaration.forEachChild((node) => {
              if (ts.isFunctionTypeNode(node)) {
                fnTypeNode = node
              } else if (ts.isTypeReferenceNode(node)) {
                const type = context.checker.getTypeAtLocation(node)
                const sym = type.symbol || type.aliasSymbol
                const decl = sym.declarations
                decl?.forEach((node) => {
                  if (ts.isFunctionTypeNode(node)) fnTypeNode = node
                })
              }
            })

            if (!fnTypeNode) continue

            const { declaration: eventDeclaration } =
              context.converter.convertType(
                context,
                fnTypeNode
              ) as ReflectionType
            if (!eventDeclaration) continue // Invalid type
            if (
              !eventDeclaration.signatures ||
              eventDeclaration.signatures.length === 0
            )
              continue
            eventDeclaration.name = prop.getName()
            eventDeclaration.escapedName = prop.getEscapedName()
            eventDeclaration.signatures[0].name = prop.getName()
            _events.push([_reflection.id, eventDeclaration])
          }
        }
      }
    }
  )

  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context: Context) => {
    for (const [reflectionId, eventDeclaration] of _events) {
      const reflection = context.project.getReflectionById(reflectionId)
      if (!reflection) continue
      const rc = context.withScope(reflection)
      eventDeclaration.parent = reflection
      eventDeclaration.kind = ReflectionKind.Event
      rc.addChild(eventDeclaration)
    }
  })
}
