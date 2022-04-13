import $ from 'jquery';
import ModalComponent from 'ghost-admin/components/modal-base';
import copyTextToClipboard from 'ghost-admin/utils/copy-text-to-clipboard';
import {action, computed} from '@ember/object';
import {htmlSafe} from '@ember/template';
import {inject as service} from '@ember/service';
import {task, timeout} from 'ember-concurrency';
const ICON_EXTENSIONS = ['gif', 'jpg', 'jpeg', 'png', 'svg'];

export default ModalComponent.extend({
    config: service(),
    membersUtils: service(),
    settings: service(),
    store: service(),
    session: service(),
    feature: service(),
    ghostPaths: service(),
    ajax: service(),

    page: 'signup',
    iconExtensions: null,
    isShowModalLink: true,
    customIcon: null,
    showLinksPage: false,
    showLeaveSettingsModal: false,
    isPreloading: true,
    changedProducts: null,
    portalPreviewGuid: 'modal-portal-settings',

    confirm() {},

    backgroundStyle: computed('settings.accentColor', function () {
        let color = this.settings.get('accentColor') || '#ffffff';
        return htmlSafe(`background-color: ${color}`);
    }),

    disableUpdateSupportAddressButton: computed('supportAddress', function () {
        const savedSupportAddress = this.get('settings.membersSupportAddress') || '';
        if (!savedSupportAddress.includes('@') && this.config.emailDomain) {
            return !this.supportAddress || (this.supportAddress === `${savedSupportAddress}@${this.config.emailDomain}`);
        }
        return !this.supportAddress || (this.supportAddress === savedSupportAddress);
    }),

    showModalLinkOrAttribute: computed('isShowModalLink', function () {
        if (this.isShowModalLink) {
            return `#/portal`;
        }
        return `data-portal`;
    }),

    portalPreviewUrl: computed('page', 'model.products.[]', 'changedProducts.[]', 'membersUtils.{isFreeChecked,isMonthlyChecked,isYearlyChecked}', 'settings.{portalName,portalButton,portalButtonIcon,portalButtonSignupText,portalButtonStyle,accentColor,portalPlans.[]}', function () {
        const options = this.getProperties(['page']);
        options.portalProducts = this.model.products?.filter((product) => {
            return product.get('visibility') === 'public'
                && product.get('active') === true
                && product.get('type') === 'paid';
        }).map((product) => {
            return product.id;
        });
        const freeProduct = this.model.products?.find((product) => {
            return product.type === 'free';
        });
        options.isFreeChecked = freeProduct?.visibility === 'public';
        return this.membersUtils.getPortalPreviewUrl(options);
    }),

    showIconSetting: computed('selectedButtonStyle', function () {
        const selectedButtonStyle = this.get('selectedButtonStyle.name') || '';
        return selectedButtonStyle.includes('icon');
    }),

    showButtonTextSetting: computed('selectedButtonStyle', function () {
        const selectedButtonStyle = this.get('selectedButtonStyle.name') || '';
        return selectedButtonStyle.includes('text');
    }),

    selectedButtonStyle: computed('settings.portalButtonStyle', function () {
        return this.buttonStyleOptions.find((buttonStyle) => {
            return (buttonStyle.name === this.settings.get('portalButtonStyle'));
        });
    }),

    isFreeChecked: computed('settings.{portalPlans.[],membersSignupAccess}', function () {
        const allowedPlans = this.settings.get('portalPlans') || [];
        return (this.settings.get('membersSignupAccess') === 'all' && allowedPlans.includes('free'));
    }),
    isMonthlyChecked: computed('settings.portalPlans.[]', 'isStripeConfigured', function () {
        const allowedPlans = this.settings.get('portalPlans') || [];
        return (this.membersUtils.isStripeEnabled && allowedPlans.includes('monthly'));
    }),
    isYearlyChecked: computed('settings.portalPlans.[]', 'isStripeConfigured', function () {
        const allowedPlans = this.settings.get('portalPlans') || [];
        return (this.membersUtils.isStripeEnabled && allowedPlans.includes('yearly'));
    }),
    products: computed('model.products.[]', 'changedProducts.[]', 'isPreloading', function () {
        const paidProducts = this.model.products?.filter(product => product.type === 'paid' && product.active === true);
        if (this.isPreloading || !paidProducts?.length) {
            return [];
        }

        const products = paidProducts.map((product) => {
            return {
                id: product.id,
                name: product.name,
                checked: product.visibility === 'public'
            };
        });
        return products;
    }),

    showPortalTiers: computed('products', 'feature.multipleProducts', function () {
        if (this.feature.get('multipleProducts')) {
            return true;
        }
        return false;
    }),

    showPortalPrices: computed('products', 'feature.multipleProducts', function () {
        if (!this.feature.get('multipleProducts')) {
            return true;
        }

        const visibleProducts = this.model.products?.filter((product) => {
            return product.visibility === 'public' && product.type === 'paid';
        });

        return !!visibleProducts?.length;
    }),

    init() {
        this._super(...arguments);
        this.buttonStyleOptions = [
            {name: 'icon-and-text', label: 'Icon and text'},
            {name: 'icon-only', label: 'Icon only'},
            {name: 'text-only', label: 'Text only'}
        ];
        this.iconExtensions = ICON_EXTENSIONS;
        this.changedProducts = [];
        this.set('supportAddress', this.parseEmailAddress(this.settings.get('membersSupportAddress')));
    },

    didInsertElement() {
        this._super(...arguments);
        this.settings.get('errors').clear();
    },

    actions: {
        toggleFreePlan(isChecked) {
            this.updateAllowedPlan('free', isChecked);
        },
        togglePlan(plan, event) {
            this.updateAllowedPlan(plan, event.target.checked);
        },
        toggleProduct(productId, event) {
            this.updateAllowedProduct(productId, event.target.checked);
        },
        togglePortalButton(showButton) {
            this.settings.set('portalButton', showButton);
        },

        togglePortalName(showSignupName) {
            this.settings.set('portalName', showSignupName);
        },

        confirm() {
            return this.saveTask.perform();
        },

        isPlanSelected(plan) {
            const allowedPlans = this.settings.get('portalPlans');
            return allowedPlans.includes(plan);
        },

        switchPreviewPage(page) {
            if (page === 'links') {
                this.set('showLinksPage', true);
                this.set('page', '');
            } else {
                this.set('showLinksPage', false);
                this.set('page', page);
            }
        },

        switchToSignupPage() {
            if (this.showLinksPage) {
                this.set('showLinksPage', false);
                this.set('page', 'signup');
            }
        },

        setButtonStyle(buttonStyle) {
            this.settings.set('portalButtonStyle', buttonStyle.name);
        },

        setSignupButtonText(event) {
            this.settings.set('portalButtonSignupText', event.target.value);
        },
        /**
         * Fired after an image upload completes
         * @param  {string} property - Property name to be set on `this.settings`
         * @param  {UploadResult[]} results - Array of UploadResult objects
         * @return {string} The URL that was set on `this.settings.property`
         */
        imageUploaded(property, results) {
            if (results[0]) {
                this.set('customIcon', results[0].url);
                this.settings.set('portalButtonIcon', results[0].url);
            }
        },
        /**
         * Opens a file selection dialog - Triggered by "Upload Image" buttons,
         * searches for the hidden file input within the .gh-setting element
         * containing the clicked button then simulates a click
         * @param  {MouseEvent} event - MouseEvent fired by the button click
         */
        triggerFileDialog(event) {
            // simulate click to open file dialog
            // using jQuery because IE11 doesn't support MouseEvent
            $(event.target)
                .closest('.gh-setting-action')
                .find('input[type="file"]')
                .click();
        },

        deleteCustomIcon() {
            this.set('customIcon', null);
            this.settings.set('portalButtonIcon', this.membersUtils.defaultIconKeys[0]);
        },

        selectDefaultIcon(icon) {
            this.settings.set('portalButtonIcon', icon);
        },

        closeLeaveSettingsModal() {
            this.set('showLeaveSettingsModal', false);
        },

        openStripeSettings() {
            this.isWaitingForStripeConnection = true;
            this.model.openStripeSettings();
        },

        leaveSettings() {
            this.closeModal();
        },

        validateFreeSignupRedirect() {
            return this._validateSignupRedirect(this.freeSignupRedirect, 'membersFreeSignupRedirect');
        },

        validatePaidSignupRedirect() {
            return this._validateSignupRedirect(this.paidSignupRedirect, 'membersPaidSignupRedirect');
        },

        setSupportAddress(supportAddress) {
            this.set('supportAddress', supportAddress);
        }
    },

    parseEmailAddress(address) {
        const emailAddress = address || 'noreply';
        // Adds default domain as site domain
        if (emailAddress.indexOf('@') < 0 && this.config.emailDomain) {
            return `${emailAddress}@${this.config.emailDomain}`;
        }
        return emailAddress;
    },

    updateAllowedPlan(plan, isChecked) {
        const portalPlans = this.settings.get('portalPlans') || [];
        const allowedPlans = [...portalPlans];
        const freeProduct = this.model.products.find(p => p.type === 'free');

        if (!isChecked) {
            this.settings.set('portalPlans', allowedPlans.filter(p => p !== plan));
            if (plan === 'free') {
                freeProduct.set('visibility', 'none');
            }
        } else {
            allowedPlans.push(plan);
            this.settings.set('portalPlans', allowedPlans);
            if (plan === 'free') {
                freeProduct.set('visibility', 'public');
            }
        }
    },

    updateAllowedProduct(productId, isChecked) {
        const product = this.model.products.find(p => p.id === productId);
        if (!isChecked) {
            product.set('visibility', 'none');
        } else {
            product.set('visibility', 'public');
        }
        let portalProducts = this.model.products.filter((p) => {
            return p.visibility === 'public';
        }).map(p => p.id);
        this.set('changedProducts', portalProducts);
    },

    _validateSignupRedirect(url, type) {
        let errMessage = `Please enter a valid URL`;
        this.settings.get('errors').remove(type);
        this.settings.get('hasValidated').removeObject(type);

        if (url === null) {
            this.settings.get('errors').add(type, errMessage);
            this.settings.get('hasValidated').pushObject(type);
            return false;
        }

        if (url === undefined) {
            // Not initialised
            return;
        }

        if (url.href.startsWith(this.siteUrl)) {
            const path = url.href.replace(this.siteUrl, '');
            this.settings.set(type, path);
        } else {
            this.settings.set(type, url.href);
        }
    },

    finishPreloading: action(async function () {
        if (this.model.preloadTask?.isRunning) {
            await this.model.preloadTask;
        }

        const portalButtonIcon = this.settings.get('portalButtonIcon') || '';
        if (portalButtonIcon && !this.membersUtils.defaultIconKeys.includes(portalButtonIcon)) {
            this.set('customIcon', this.settings.get('portalButtonIcon'));
        }

        this.siteUrl = this.config.get('blogUrl');
        this.set('isPreloading', false);
    }),

    refreshAfterStripeConnected: action(async function () {
        if (this.isWaitingForStripeConnection) {
            await this.finishPreloading();
            this.notifyPropertyChange('page'); // force preview url to recompute
            this.set('portalPreviewGuid', Date.now().valueOf()); // force preview re-render
            this.isWaitingForStripeConnection = false;
        }
    }),

    copyLinkOrAttribute: task(function* () {
        copyTextToClipboard(this.showModalLinkOrAttribute);
        yield timeout(this.isTesting ? 50 : 3000);
    }),

    saveTask: task(function* () {
        this.send('validateFreeSignupRedirect');
        this.send('validatePaidSignupRedirect');
        if (this.settings.get('errors').length !== 0) {
            return;
        }

        // Save tier visibility if changed
        yield Promise.all(
            this.model.products.filter((product) => {
                const changedAttrs = product.changedAttributes();
                return !!changedAttrs.visibility;
            }).map((product) => {
                return product.save();
            })
        );

        yield this.settings.save();

        this.closeModal();
    }).drop(),

    updateSupportAddress: task(function* () {
        let url = this.get('ghostPaths.url').api('/settings/members/email');
        try {
            const response = yield this.ajax.post(url, {
                data: {
                    email: this.supportAddress,
                    type: 'supportAddressUpdate'
                }
            });
            // this.toggleProperty('showSupportAddressConfirmation');
            return response;
        } catch (e) {
            // Failed to send email, retry
            return false;
        }
    }).drop()
});
