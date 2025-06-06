// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import * as Common from '../../core/common/common.js';
import * as Host from '../../core/host/host.js';
import * as i18n from '../../core/i18n/i18n.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as DataGrid from '../../ui/legacy/components/data_grid/data_grid.js';
import * as UI from '../../ui/legacy/legacy.js';
import * as VisualLogging from '../../ui/visual_logging/visual_logging.js';
import eventSourceMessagesViewStyles from './eventSourceMessagesView.css.js';
const UIStrings = {
    /**
     *@description Text in Event Source Messages View of the Network panel
     */
    id: 'Id',
    /**
     *@description Text that refers to some types
     */
    type: 'Type',
    /**
     *@description Text in Event Source Messages View of the Network panel
     */
    data: 'Data',
    /**
     *@description Text that refers to the time
     */
    time: 'Time',
    /**
     *@description Data grid name for Event Source data grids
     */
    eventSource: 'Event Source',
    /**
     *@description A context menu item in the Resource Web Socket Frame View of the Network panel
     */
    copyMessage: 'Copy message',
    /**
     *@description Text to clear everything
     */
    clearAll: 'Clear all',
    /**
     *@description Example for placeholder text
     */
    enterRegex: 'Enter regex, for example: https?',
};
const str_ = i18n.i18n.registerUIStrings('panels/network/EventSourceMessagesView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
export class EventSourceMessagesView extends UI.Widget.VBox {
    request;
    dataGrid;
    mainToolbar;
    clearAllButton;
    filterTextInput;
    filterRegex;
    messageFilterSetting = Common.Settings.Settings.instance().createSetting('network-event-source-message-filter', '');
    constructor(request) {
        super();
        this.element.classList.add('event-source-messages-view');
        this.element.setAttribute('jslog', `${VisualLogging.pane('event-stream').track({ resize: true })}`);
        this.request = request;
        this.mainToolbar = new UI.Toolbar.Toolbar('');
        this.clearAllButton = new UI.Toolbar.ToolbarButton(i18nString(UIStrings.clearAll), 'clear');
        this.clearAllButton.addEventListener("Click" /* UI.Toolbar.ToolbarButton.Events.Click */, this.clearMessages, this);
        this.mainToolbar.appendToolbarItem(this.clearAllButton);
        const placeholder = i18nString(UIStrings.enterRegex);
        this.filterTextInput = new UI.Toolbar.ToolbarInput(placeholder, '', 0.4);
        this.filterTextInput.addEventListener("TextChanged" /* UI.Toolbar.ToolbarInput.Event.TextChanged */, this.updateFilterSetting, this);
        const filter = this.messageFilterSetting.get();
        this.filterRegex = null;
        this.setFilter(filter);
        if (filter) {
            this.filterTextInput.setValue(filter);
        }
        this.mainToolbar.appendToolbarItem(this.filterTextInput);
        this.element.appendChild(this.mainToolbar.element);
        const columns = [
            { id: 'id', title: i18nString(UIStrings.id), sortable: true, weight: 8 },
            { id: 'type', title: i18nString(UIStrings.type), sortable: true, weight: 8 },
            { id: 'data', title: i18nString(UIStrings.data), sortable: false, weight: 88 },
            { id: 'time', title: i18nString(UIStrings.time), sortable: true, weight: 8 },
        ];
        this.dataGrid = new DataGrid.SortableDataGrid.SortableDataGrid({
            displayName: i18nString(UIStrings.eventSource),
            columns,
            editCallback: undefined,
            deleteCallback: undefined,
            refreshCallback: undefined,
        });
        this.dataGrid.setStriped(true);
        this.dataGrid.setStickToBottom(true);
        this.dataGrid.setRowContextMenuCallback(this.onRowContextMenu.bind(this));
        this.dataGrid.markColumnAsSortedBy('time', DataGrid.DataGrid.Order.Ascending);
        this.sortItems();
        this.dataGrid.addEventListener("SortingChanged" /* DataGrid.DataGrid.Events.SortingChanged */, this.sortItems, this);
        this.dataGrid.setName('event-source-messages-view');
        this.dataGrid.asWidget().show(this.element);
    }
    wasShown() {
        this.refresh();
        this.registerCSSFiles([eventSourceMessagesViewStyles]);
        this.request.addEventListener(SDK.NetworkRequest.Events.EventSourceMessageAdded, this.messageAdded, this);
    }
    willHide() {
        this.request.removeEventListener(SDK.NetworkRequest.Events.EventSourceMessageAdded, this.messageAdded, this);
    }
    messageAdded(event) {
        const message = event.data;
        if (!this.messageFilter(message)) {
            return;
        }
        this.dataGrid.insertChild(new EventSourceMessageNode(message));
    }
    messageFilter(message) {
        return !this.filterRegex || this.filterRegex.test(message.eventName) || this.filterRegex.test(message.eventId) ||
            this.filterRegex.test(message.data);
    }
    clearMessages() {
        clearMessageOffsets.set(this.request, this.request.eventSourceMessages().length);
        this.refresh();
    }
    updateFilterSetting() {
        const text = this.filterTextInput.value();
        this.messageFilterSetting.set(text);
        this.setFilter(text);
        this.refresh();
    }
    setFilter(text) {
        this.filterRegex = null;
        if (text) {
            try {
                this.filterRegex = new RegExp(text, 'i');
            }
            catch (e) {
                // this regex will never match any input
                this.filterRegex = new RegExp('(?!)', 'i');
            }
        }
    }
    sortItems() {
        const sortColumnId = this.dataGrid.sortColumnId();
        if (!sortColumnId) {
            return;
        }
        const comparator = Comparators[sortColumnId];
        if (!comparator) {
            return;
        }
        this.dataGrid.sortNodes(comparator, !this.dataGrid.isSortOrderAscending());
    }
    onRowContextMenu(contextMenu, node) {
        contextMenu.clipboardSection().appendItem(i18nString(UIStrings.copyMessage), Host.InspectorFrontendHost.InspectorFrontendHostInstance.copyText.bind(Host.InspectorFrontendHost.InspectorFrontendHostInstance, node.data.data), { jslogContext: 'copy' });
    }
    refresh() {
        this.dataGrid.rootNode().removeChildren();
        let messages = this.request.eventSourceMessages();
        const offset = clearMessageOffsets.get(this.request) || 0;
        messages = messages.slice(offset);
        messages = messages.filter(this.messageFilter.bind(this));
        messages.forEach(message => this.dataGrid.insertChild(new EventSourceMessageNode(message)));
    }
}
export class EventSourceMessageNode extends DataGrid.SortableDataGrid.SortableDataGridNode {
    message;
    constructor(message) {
        const time = new Date(message.time * 1000);
        const timeText = ('0' + time.getHours()).substr(-2) + ':' + ('0' + time.getMinutes()).substr(-2) + ':' +
            ('0' + time.getSeconds()).substr(-2) + '.' + ('00' + time.getMilliseconds()).substr(-3);
        const timeNode = document.createElement('div');
        UI.UIUtils.createTextChild(timeNode, timeText);
        UI.Tooltip.Tooltip.install(timeNode, time.toLocaleString());
        super({ id: message.eventId, type: message.eventName, data: message.data, time: timeNode });
        this.message = message;
    }
}
// TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
// eslint-disable-next-line @typescript-eslint/naming-convention
export function EventSourceMessageNodeComparator(fieldGetter, a, b) {
    const aValue = fieldGetter(a.message);
    const bValue = fieldGetter(b.message);
    return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
}
export const Comparators = {
    'id': EventSourceMessageNodeComparator.bind(null, message => message.eventId),
    'type': EventSourceMessageNodeComparator.bind(null, message => message.eventName),
    'time': EventSourceMessageNodeComparator.bind(null, message => message.time),
};
const clearMessageOffsets = new WeakMap();
//# sourceMappingURL=EventSourceMessagesView.js.map