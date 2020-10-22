import { WebviewPanel, ExtensionContext, Uri, window, OpenDialogOptions } from 'vscode';
import { join, dirname } from 'path'
import { readFileSync, statSync } from 'fs';
import { get_css } from './doc_panel_fcns'

const osu = require('node-os-utils')

export interface PlotPanel extends WebviewPanel {
    log?: string
    last_read?: number
    dump?: string
    dump_last_read?: number
}

const re_log_data: RegExp = RegExp('^\\s*((-?[0-9]*(\\.[0-9]*)?([eE][-]?)?[0-9]+)\\s+)+(-?[0-9]*(\\.[0-9]*)?([eE][-]?)?[0-9]+)?', 'gm')

interface plot_data {
    x: number[] | string[],
    y: number[] | string[],
    mode?: string,
    name?: string,
    xaxis?: string,
    yaxis?: string,
    line?: {
        color?: string,
        shape?: string,
        width?: number,
        dash?: string
    }
}

interface dump_data {
    x: number[] | string[],
    y: number[] | string[],
    z: number[] | string[],
    mode?: string,
    name?: string,
    marker?: {
        color?: any
        size?: number,
        line?: {
            color?: any,
            width?: number
        },
        opacity?: number
    },
    type: string
}

const colors =
    ['#1f77b4',  // muted blue
    '#ff7f0e',  // safety orange
    '#2ca02c',  // cooked asparagus green
    '#d62728',  // brick red
    '#9467bd',  // muted purple
    '#8c564b',  // chestnut brown
    '#e377c2',  // raspberry yogurt pink
    '#7f7f7f',  // middle gray
    '#bcbd22',  // curry yellow-green
    '#17becf']   // blue-teal

interface ax_layout {
    [key: string]: any
}

enum file_type {
    log,
    dump
}
export async function manage_plot_panel(context: ExtensionContext, panel: PlotPanel | undefined, actCol: number): Promise<PlotPanel | undefined> {

    const img_path_light = Uri.file(join(context.extensionPath, 'imgs', 'logo_sq_l.gif'))
    const img_path_dark = Uri.file(join(context.extensionPath, 'imgs', 'logo_sq_d.gif'))

    if (panel) {
        // If we already have a panel, show it in the target column
        panel.reveal(actCol);
    } else {
        // Otherwise, create a new panel
        panel = window.createWebviewPanel(
            'lmpsPlot',
            'Lammps Dashboard', actCol, { retainContextWhenHidden: true, enableScripts: true }
        );
        panel.iconPath = { light: img_path_light, dark: img_path_dark }
        panel.onDidChangeViewState(
            e => {
                actCol = e.webviewPanel.viewColumn!
            },
            null,
            context.subscriptions
        );
        panel.webview.onDidReceiveMessage(
            message => {
                if (panel) {
                    switch (message.command) {
                        case 'load_log':
                            panel.log = undefined;
                            set_plot_panel_content(panel, context, file_type.log)
                            break;
                        case 'load_dump':
                            panel.dump = undefined;
                            set_plot_panel_content(panel, context, file_type.dump)
                            break;
                        case 'update_log':
                            get_update(panel)
                            break;
                        case 'get_sys_info':
                            get_system_info().then((s: any) => {
                                panel?.webview.postMessage({ type: 'sys_info', data: s })
                            });
                            break;
                    }
                    return;
                }
            },
            null,
            context.subscriptions
        );

        context.subscriptions.push(panel)
    }
    draw_panel(panel, context)
    return panel
}

function get_update(panel: PlotPanel | undefined) {
    if (panel?.log) {
        const last_write: number = statSync(panel.log).mtime.getTime()
        if (last_write > panel.last_read!) {
            const log_data = get_log_data(panel.log)
            if (log_data) {
                panel.webview.postMessage({ type: 'update_log', data: log_data.data, layout: log_data.layout });
                panel.last_read = Date.now()
            }
        }
    }
    if (panel?.dump) {
        const last_write: number = statSync(panel.dump).mtime.getTime()
        if (last_write > panel.dump_last_read!) {
            const dump_data = get_dump_data(panel.dump)
            if (dump_data) {
                panel.webview.postMessage({ type: 'update_dump', data: dump_data.data });
                panel.last_read = Date.now()
            }
        }
    }
}
export function draw_panel(panel: PlotPanel, context: ExtensionContext) {
    const script_lib: Uri = panel.webview.asWebviewUri(Uri.file(join(context.extensionPath, 'node_modules', 'plotly.js-dist-min', 'plotly.min.js')))
    const script: Uri = panel.webview.asWebviewUri(Uri.file(join(context.extensionPath, 'src', 'dashboard.js')))
    const css = get_css(panel, context)
    panel.webview.html = css + build_plot_html(script_lib, script)
    if (panel.log) {
        set_plot_panel_content(panel, context, file_type.log)
    }
    if (panel.dump) {
        set_plot_panel_content(panel, context, file_type.dump)
    }
}


function get_log_data(path: string): { data: plot_data[], layout: ax_layout } | undefined {
    let ax_layouts: ax_layout = {}
    let dat_log = read_log_data(path)
    if (dat_log) {
        let dat: plot_data[] = []
        for (let iy = 0; iy < dat_log.length; iy++) {
            let x_axis_lab: string = 'xaxis'
            let x_axis_lab_short: string = 'x'
            let y_axis_lab: string = 'yaxis'
            let y_axis_lab_short: string = 'y'
            if (iy > 0) {
                x_axis_lab = 'xaxis' + (iy + 1).toString()
                x_axis_lab_short = 'x' + (iy + 1).toString()
                y_axis_lab = 'yaxis' + (iy + 1).toString()
                y_axis_lab_short = 'y' + (iy + 1).toString()

            }

            for (let ix = 1; ix < dat_log[iy].data[0].length; ix++) {
                dat.push({
                    x: dat_log[iy].data.map(data => data[0]),
                    y: dat_log[iy].data.map(data => data[ix]),
                    xaxis: x_axis_lab_short,
                    yaxis: y_axis_lab_short,
                    name: dat_log[iy].header[ix],
                    mode: 'line',
                    line: {
                        width: 2,
                    }
                })
                ax_layouts[x_axis_lab] = { domain: [0, 1], anchor: y_axis_lab_short }
                ax_layouts[y_axis_lab] = { domain: [iy / dat_log.length, (iy + 1) / dat_log.length - 0.1] }
            }
        }
        return { data: dat, layout: ax_layouts }
    }
}

function get_dump_data(path: string): { data: dump_data[] } | undefined {
    let dat_log = read_log_data(path)
    if (dat_log) {
        let dat: dump_data[] = []
        for (let iy = 0; iy < dat_log.length; iy++) {
            for (let ix = 1; ix < dat_log[iy].data[0].length; ix++) {
                let ty: number[] = dat_log[iy].data.map(data => parseInt(data[1]))
                let col: string[] = ty.map(c => colors[c])
                dat.push({
                    x: dat_log[iy].data.map(data => data[2]),
                    y: dat_log[iy].data.map(data => data[3]),
                    z: dat_log[iy].data.map(data => data[4]),
                    mode: 'markers',
                    marker: {
                        color: col,
                        size: 10,
                        line: {
                            color: 'black',
                            width: 0.25
                        },
                        opacity: 0.8
                    },
                    type: 'scatter3d'
                })
            }
        }
        return { data: dat }
    }
}

export async function set_plot_panel_content(panel: PlotPanel | undefined, context: ExtensionContext, f_type: file_type) {
    if (panel) {
        switch (f_type) {
            case 0:
                if (panel.log == undefined) {
                    panel.log = await get_log_path('Open Lammps Log File') // Let user select a log file
                }
                if (panel.log) {
                    const log_data = get_log_data(panel.log)
                    if (log_data) {
                        panel.webview.postMessage({ type: 'plot_log', data: log_data.data, layout: log_data.layout });
                        panel.last_read = Date.now()
                    }
                }
                break;
            case 1:
                if (panel.dump == undefined) {
                    panel.dump = await get_log_path('Open Lammps Dump File') // Let user select a dump file
                }
                if (panel.dump) {
                    const dump_data = get_dump_data(panel.dump)
                    if (dump_data) {
                        panel.webview.postMessage({ type: 'plot_dump', data: dump_data.data });
                        panel.last_read = Date.now()
                    }
                }
                break;

            default:
                break;
        }
    }
}


function get_system_info(): Promise<{ memory: number, cpu: number } | void> {
    const p_mem: Promise<number> = osu.mem.info().then((info: any): number => {
        return 100 - info.freeMemPercentage
    })
    const p_cpu: Promise<number> = osu.cpu.usage().then((cpuPercentage: any): number => {
        return cpuPercentage
    })
    return p_mem.then(function (mem_prct) {
        return p_cpu.then((cpu_prct) => {
            return { memory: mem_prct, cpu: cpu_prct };
        })
    })
}

function read_log_data(log_path: string) {
    if (log_path) {
        const log_file = readFileSync(log_path).toString()       // Read entire Log_file
        let data_block                                           // Find Data Blocks
        let log_ds: {                                            // Initialize Array of Datablocks
            header: string[],
            data: string[][]
        }[] = []

        while ((data_block = re_log_data.exec(log_file)) != null) {
            let header = data_block.input.slice(data_block.input.slice(0, data_block.index - 1).lastIndexOf('\n'), data_block.index).trim().split(RegExp('\\s+', 'g'))
            header = header.filter(e => e !== 'ITEM:' && e !== 'ATOMS')
            const dat_l = data_block.toString().split(RegExp("\\n+", "g"))
            const dat_n: string[][] = dat_l.map((value) => value.trim().split(RegExp('\\s+')))
            if (header.length == dat_n[0].length) {
                log_ds.push({ header: header, data: dat_n })
            }
        }
        return log_ds
    }
}


async function get_log_path(title: string): Promise<string | undefined> {
    const options: OpenDialogOptions = {
        canSelectMany: false,
        title: title,
        canSelectFolders: false
    };
    const cwd = window.activeTextEditor?.document.uri
    if (cwd) {
        options.defaultUri = Uri.parse(dirname(cwd.toString()))
    }
    let log_path: string | undefined = undefined
    const fileUri = await window.showOpenDialog(options)
    if (fileUri && fileUri[0]) {
        log_path = fileUri[0].fsPath
    }
    return log_path
}

function build_plot_html(plotly_lib: Uri, script: Uri) {

    const html: string =
        `<!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!-- Include Plotly.js -->
        <script src="${plotly_lib}"></script>   
    </head>

    <body>

        <!-- Tab links -->
        <div class="tab">
          <button class="tablinks" onclick="openTab(event, 'sys')" id="default_tab">System Information</button>
          <button class="tablinks" onclick="openTab(event, 'dump')">Dumps</button>
          <button class="tablinks" onclick="openTab(event, 'logs')">Logs</button>
        </div>
        
        <!-- Tab content -->
        <div id="sys" class="tabcontent">
          <h3>System Information</h3>
          <div>
          <table>
            <tr>
                <td><label for="memory">Memory usage:</label></td>
                <td><progress id="memory" value="0" max="100" style="width:100%; padding: 2px 4px;"></progress> </td>
            </tr>
            <tr>
                <td><label for="cpu">CPU load:</label></td>
                <td><progress id="cpu" value="0" max="100" style="width:100%; padding: 2px 4px;"></progress> </td>
            </tr>
            </table>
          </div>
        </div>
        
        <div id="dump" class="tabcontent">
          <h3>Dumps</h3>
          <div>
            <button type="button" id="button2">Open Lammps Dump File</button>
            <div id="dump_div" align="center">
            <!-- Plotly chart will be drawn inside this DIV -->
            </div>
          </div>
        </div>
        
        <div id="logs" class="tabcontent">
          <h3>Logs</h3>
          <div>
            <button type="button" id="button1">Open Lammps Log File</button>
          </div>
          <div id="plot_div">
           <!-- Plotly chart will be drawn inside this DIV -->
          </div>
        </div> 
    
        <script src="${script}"></script>
    </body>   

    </html>`;
    return html
}